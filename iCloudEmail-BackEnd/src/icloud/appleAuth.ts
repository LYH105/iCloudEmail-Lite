/*
 * Headless iCloud web login via Apple's SRP-6a flow — no browser.
 *
 * Ported from the reference Python client. Three steps, one session:
 *   1) signin/init      send SRP public A, get salt / B / iterations
 *   2) signin/complete  submit M1/M2 (+ trust token); 200 = trusted (no 2FA),
 *                       401 = bad password, 409 = 2FA required (phone SMS)
 *   3) accountLogin     exchange the session token for iCloud session cookies
 *
 * The trust token minted after an SMS verification lets subsequent logins
 * skip the SMS entirely (Apple honours it for ~90 days, sliding). That is
 * what makes silent, background re-login possible when cookies expire —
 * instead of forcing the user through the browser + 2FA again.
 */
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { AppleSRP, derivePassword, pad, toBytes } from './srp.js';

const WIDGET_KEY = 'd39ba9916b7251055b22c7f910e2ea796ee65e98b2ddecea8f5dde8d9d1a815d';
const AUTH_BASE = 'https://idmsa.apple.com/appleauth/auth';
const UA_AUTH =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: 'bad_credentials' | 'flow' | 'account_login' = 'flow',
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface RegionConf {
  redirect: string;
  setup: string;
  origin: string;
  domainId: string;
  locale: string;
  country: string | null;
}

/** Per-region login/service endpoints. China-mainland accounts must use .com.cn. */
export function regionConf(china: boolean): RegionConf {
  if (china) {
    return {
      redirect: 'https://www.icloud.com.cn',
      setup: 'https://setup.icloud.com.cn/setup/ws/1',
      origin: 'https://www.icloud.com.cn',
      domainId: '6',
      locale: 'zh_CN',
      country: 'CHN',
    };
  }
  return {
    redirect: 'https://www.icloud.com',
    setup: 'https://setup.icloud.com/setup/ws/1',
    origin: 'https://www.icloud.com',
    domainId: '3',
    locale: 'en_US',
    country: null,
  };
}

/* --------------------------------- cookies -------------------------------- */

export interface StoredCookie {
  name: string;
  value: string;
  domain: string; // host, no leading dot
  path: string;
  secure: boolean;
  expires: number | null; // epoch seconds
  hostOnly: boolean; // true when no explicit Domain= attribute (exact-host match only)
}

function parseSetCookie(line: string, requestHost: string): StoredCookie | null {
  const parts = line.split(';');
  const nv = parts.shift();
  if (!nv) return null;
  const eq = nv.indexOf('=');
  if (eq < 0) return null;
  const name = nv.slice(0, eq).trim();
  const value = nv.slice(eq + 1).trim();
  if (!name) return null;
  let domain = requestHost;
  let hostOnly = true;
  let path = '/';
  let secure = false;
  let expires: number | null = null;
  for (const attr of parts) {
    const idx = attr.indexOf('=');
    const key = (idx < 0 ? attr : attr.slice(0, idx)).trim().toLowerCase();
    const val = idx < 0 ? '' : attr.slice(idx + 1).trim();
    if (key === 'domain' && val) {
      domain = val.replace(/^\./, '');
      hostOnly = false;
    } else if (key === 'path' && val) path = val;
    else if (key === 'secure') secure = true;
    else if (key === 'expires') {
      const t = Date.parse(val);
      if (!Number.isNaN(t)) expires = Math.floor(t / 1000);
    } else if (key === 'max-age') {
      const s = Number.parseInt(val, 10);
      if (!Number.isNaN(s)) expires = Math.floor(Date.now() / 1000) + s;
    }
  }
  return { name, value, domain, path, secure, expires, hostOnly };
}

function domainMatch(host: string, cookie: StoredCookie): boolean {
  if (cookie.hostOnly) return host === cookie.domain;
  return host === cookie.domain || host.endsWith(`.${cookie.domain}`);
}

/** Minimal cookie jar: accumulate Set-Cookie across the flow, emit Cookie headers. */
class CookieJar {
  private jar = new Map<string, StoredCookie>();

  ingest(res: Response, requestUrl: string): void {
    const host = new URL(requestUrl).hostname;
    for (const line of res.headers.getSetCookie()) {
      const c = parseSetCookie(line, host);
      if (c) this.jar.set(`${c.domain}|${c.path}|${c.name}`, c);
    }
  }

  headerFor(url: string): string {
    const { hostname } = new URL(url);
    return [...this.jar.values()]
      .filter((c) => domainMatch(hostname, c))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }

  /** Cookie header for any icloud.com / icloud.com.cn host (what HME needs). */
  icloudHeader(): string {
    return [...this.jar.values()]
      .filter((c) => c.domain.includes('icloud.com'))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }

  all(): StoredCookie[] {
    return [...this.jar.values()];
  }
}

/* ------------------------------- idmsa state ------------------------------ */

/** Tracks the rotating idmsa session headers (scnt / session-id / attributes). */
class AuthContext {
  readonly state = randomUUID();
  scnt: string | null = null;
  sid: string | null = null;
  attr: string | null = null;
  country: string | null = null;

  constructor(private readonly conf: RegionConf) {}

  sync(res: Response): void {
    const h = res.headers;
    this.scnt = h.get('scnt') ?? this.scnt;
    this.sid = h.get('X-Apple-ID-Session-Id') ?? this.sid;
    this.attr = h.get('X-Apple-Auth-Attributes') ?? this.attr;
    this.country = h.get('X-Apple-ID-Account-Country') ?? this.country;
  }

  headers(extra?: Record<string, string>): Record<string, string> {
    const conf = this.conf;
    const h: Record<string, string> = {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/json',
      'User-Agent': UA_AUTH,
      Origin: 'https://idmsa.apple.com',
      Referer: 'https://idmsa.apple.com/',
      'X-Apple-Widget-Key': WIDGET_KEY,
      'X-Apple-OAuth-Client-Id': WIDGET_KEY,
      'X-Apple-OAuth-Client-Type': 'firstPartyAuth',
      'X-Apple-OAuth-Redirect-URI': conf.redirect,
      'X-Apple-OAuth-Require-Grant-Code': 'true',
      'X-Apple-OAuth-Response-Mode': 'web_message',
      'X-Apple-OAuth-Response-Type': 'code',
      'X-Apple-OAuth-State': this.state,
      'X-Apple-Domain-Id': conf.domainId,
      'X-Apple-Locale': conf.locale,
      'X-Apple-I-FD-Client-Info': JSON.stringify({
        U: UA_AUTH,
        L: conf.locale.replace('_', '-'),
        Z: 'GMT+08:00',
        V: '1.1',
        F: '',
      }),
    };
    if (this.scnt) h.scnt = this.scnt;
    if (this.sid) h['X-Apple-ID-Session-Id'] = this.sid;
    if (this.attr) h['X-Apple-Auth-Attributes'] = this.attr;
    return extra ? { ...h, ...extra } : h;
  }
}

/* --------------------------------- helpers -------------------------------- */

const b64 = (b: Buffer): string => b.toString('base64');
const fromB64 = (s: string): Buffer => Buffer.from(s, 'base64');

async function serviceError(res: Response): Promise<string> {
  try {
    const j = (await res.clone().json()) as { serviceErrors?: { message?: string }[] };
    return j.serviceErrors?.[0]?.message ?? '';
  } catch {
    return '';
  }
}

export interface TrustedPhone {
  id: number;
  display: string;
}

export interface AuthedSession {
  appleId: string;
  dsid: string;
  webserviceUrl: string;
  cookieHeader: string; // icloud.com(.cn) cookies, for the HME client
  cookies: StoredCookie[]; // full jar, for opening signed-in pages
  trustToken: string; // effective (possibly freshly rolled) trust token
}

/** In-flight 2FA state, held between beginLogin and submitSmsCode. */
export interface PendingLogin {
  jar: CookieJar;
  ctx: AuthContext;
  conf: RegionConf;
  clientId: string;
  appleId: string;
  password: string;
  china: boolean;
  passedTrustToken: string | null;
  phones: TrustedPhone[];
  phoneId: number;
  nonFteu: boolean;
  createdAt: number;
}

export type BeginResult =
  | { status: 'active'; session: AuthedSession }
  | { status: 'need_code'; pending: PendingLogin };

interface BeginOptions {
  appleId: string;
  password: string;
  china: boolean;
  clientId: string;
  trustToken?: string | null;
}

/**
 * Run signin/init + signin/complete. Returns a ready session when the trust
 * token still holds (no 2FA), or a `need_code` pending state otherwise. No SMS
 * is sent here — the caller decides whether to (interactive) or to abort
 * (silent background refresh). Throws AuthError on a bad password.
 */
export async function beginLogin(opts: BeginOptions): Promise<BeginResult> {
  const conf = regionConf(opts.china);
  const jar = new CookieJar();
  const ctx = new AuthContext(conf);

  const request = async (
    url: string,
    method: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<Response> => {
    const cookie = jar.headerFor(url);
    const res = await fetch(url, {
      method,
      headers: cookie ? { ...headers, Cookie: cookie } : headers,
      body,
    });
    jar.ingest(res, url);
    return res;
  };

  // 1) signin/init
  const srp = new AppleSRP(opts.appleId);
  const initRes = await request(
    `${AUTH_BASE}/signin/init`,
    'POST',
    ctx.headers(),
    JSON.stringify({
      a: b64(pad(toBytes(srp.A))),
      accountName: opts.appleId,
      protocols: ['s2k', 's2k_fo'],
    }),
  );
  ctx.sync(initRes);
  if (initRes.status !== 200) {
    throw new AuthError(`登录初始化失败（HTTP ${initRes.status}）`);
  }
  const init = (await initRes.json()) as {
    salt: string;
    b: string;
    c: string;
    protocol?: string;
    iteration: number;
  };
  const salt = fromB64(init.salt);
  const B = BigInt('0x' + fromB64(init.b).toString('hex'));
  const protocol = init.protocol ?? 's2k';
  srp.processChallenge(salt, B, derivePassword(opts.password, salt, init.iteration, protocol));

  // 2) signin/complete (carrying the trust token, if any)
  const completeRes = await request(
    `${AUTH_BASE}/signin/complete?isRememberMeEnabled=true`,
    'POST',
    ctx.headers(),
    JSON.stringify({
      accountName: opts.appleId,
      c: init.c,
      m1: b64(srp.M1!),
      m2: b64(srp.M2!),
      rememberMe: true,
      trustTokens: opts.trustToken ? [opts.trustToken] : [],
    }),
  );
  ctx.sync(completeRes);

  if (completeRes.status === 401) {
    throw new AuthError('Apple ID 或密码错误', 'bad_credentials');
  }

  if (completeRes.status === 200 || completeRes.status === 204) {
    const sessionToken = completeRes.headers.get('X-Apple-Session-Token');
    if (!sessionToken) throw new AuthError('登录未返回会话令牌');
    const session = await accountLogin(
      jar,
      ctx,
      conf,
      opts.clientId,
      sessionToken,
      opts.trustToken ?? '',
    );
    return { status: 'active', session };
  }

  if (completeRes.status !== 409) {
    throw new AuthError(`登录返回非预期状态（HTTP ${completeRes.status}）`);
  }

  // 409 → 2FA required. Discover trusted phone numbers (do NOT send SMS yet).
  const listRes = await request(AUTH_BASE, 'GET', ctx.headers({ Accept: 'application/json' }));
  ctx.sync(listRes);
  let phones: TrustedPhone[] = [];
  try {
    const body = (await listRes.json()) as {
      trustedPhoneNumbers?: { id?: number; numberWithDialCode?: string; obfuscatedNumber?: string }[];
    };
    phones = (body.trustedPhoneNumbers ?? []).map((p) => ({
      id: p.id ?? 1,
      display: p.numberWithDialCode || p.obfuscatedNumber || `id=${p.id ?? 1}`,
    }));
  } catch {
    phones = [];
  }

  const pending: PendingLogin = {
    jar,
    ctx,
    conf,
    clientId: opts.clientId,
    appleId: opts.appleId,
    password: opts.password,
    china: opts.china,
    passedTrustToken: opts.trustToken ?? null,
    phones,
    phoneId: phones[0]?.id ?? 1,
    nonFteu: true,
    createdAt: Date.now(),
  };
  return { status: 'need_code', pending };
}

function pendingRequest(pending: PendingLogin) {
  return async (
    url: string,
    method: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<Response> => {
    const cookie = pending.jar.headerFor(url);
    const res = await fetch(url, {
      method,
      headers: cookie ? { ...headers, Cookie: cookie } : headers,
      body,
    });
    pending.jar.ingest(res, url);
    return res;
  };
}

/** Send (or resend) the SMS security code to the given / default phone. */
export async function sendSms(pending: PendingLogin, phoneId?: number): Promise<{ phone: string }> {
  const request = pendingRequest(pending);
  if (phoneId) pending.phoneId = phoneId;
  const res = await request(
    `${AUTH_BASE}/verify/phone`,
    'PUT',
    pending.ctx.headers(),
    JSON.stringify({ phoneNumber: { id: pending.phoneId }, mode: 'sms' }),
  );
  pending.ctx.sync(res);
  if (![200, 201, 202].includes(res.status)) {
    throw new AuthError(`发送短信验证码失败（HTTP ${res.status}）`);
  }
  const phone =
    pending.phones.find((p) => p.id === pending.phoneId)?.display ?? `id=${pending.phoneId}`;
  return { phone };
}

/**
 * Submit the SMS code. On success establishes device trust, mints a fresh
 * trust token, and completes accountLogin → a ready session. On a wrong code
 * returns { ok: false } so the caller can let the user retry.
 */
export async function submitSmsCode(
  pending: PendingLogin,
  code: string,
): Promise<{ ok: true; session: AuthedSession } | { ok: false; message: string }> {
  const request = pendingRequest(pending);
  const verifyRes = await request(
    `${AUTH_BASE}/verify/phone/securitycode`,
    'POST',
    pending.ctx.headers(),
    JSON.stringify({
      phoneNumber: { id: pending.phoneId, nonFTEU: pending.nonFteu },
      securityCode: { code },
      mode: 'sms',
    }),
  );
  pending.ctx.sync(verifyRes);
  if (verifyRes.status !== 200) {
    const msg = await serviceError(verifyRes);
    return { ok: false, message: msg || `验证码不正确（HTTP ${verifyRes.status}）` };
  }

  // Establish device trust → new trust token + session token.
  const trustRes = await request(`${AUTH_BASE}/2sv/trust`, 'GET', pending.ctx.headers());
  pending.ctx.sync(trustRes);
  const sessionToken =
    trustRes.headers.get('X-Apple-Session-Token') ??
    verifyRes.headers.get('X-Apple-Session-Token');
  const newToken =
    trustRes.headers.get('X-Apple-TwoSV-Trust-Token') ??
    trustRes.headers.get('X-Apple-Trust-Token');
  if (!sessionToken) throw new AuthError('二次验证后未返回会话令牌');

  const session = await accountLogin(
    pending.jar,
    pending.ctx,
    pending.conf,
    pending.clientId,
    sessionToken,
    newToken || pending.passedTrustToken || '',
  );
  return { ok: true, session };
}

/** 3) Exchange the idmsa session token for iCloud session cookies. */
async function accountLogin(
  jar: CookieJar,
  ctx: AuthContext,
  conf: RegionConf,
  clientId: string,
  sessionToken: string,
  effectiveTrustToken: string,
): Promise<AuthedSession> {
  const url = new URL(`${conf.setup}/accountLogin`);
  url.searchParams.set('clientBuildNumber', config.icloud.clientBuildNumber);
  url.searchParams.set('clientMasteringNumber', config.icloud.clientMasteringNumber);
  url.searchParams.set('clientId', clientId);

  const cookie = jar.headerFor(url.toString());
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': UA_AUTH,
      Origin: conf.origin,
      Referer: `${conf.origin}/`,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({
      accountCountryCode: ctx.country || conf.country,
      dsWebAuthToken: sessionToken,
      extended_login: true,
      trustToken: effectiveTrustToken || '',
    }),
  });
  jar.ingest(res, url.toString());
  if (res.status !== 200) {
    throw new AuthError(`换取会话失败（HTTP ${res.status}），可能是账号区域不符`, 'account_login');
  }

  const body = (await res.json()) as {
    dsInfo?: { dsid?: string | number; appleId?: string; primaryEmail?: string };
    webservices?: Record<string, { url?: string } | undefined>;
  };
  const webserviceUrl = body.webservices?.['premiummailsettings']?.url;
  if (!webserviceUrl) {
    throw new AuthError('该账号未开通 Hide My Email（未发现 premiummailsettings 服务）', 'account_login');
  }
  const dsid = body.dsInfo?.dsid != null ? String(body.dsInfo.dsid) : '';
  return {
    appleId: body.dsInfo?.appleId ?? body.dsInfo?.primaryEmail ?? '',
    dsid,
    webserviceUrl,
    cookieHeader: jar.icloudHeader(),
    cookies: jar.all(),
    trustToken: effectiveTrustToken,
  };
}
