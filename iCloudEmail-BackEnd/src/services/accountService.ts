import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { decryptJson, decryptSecret, encryptJson, encryptSecret } from '../crypto/secrets.js';
import { logger } from '../logger.js';
import {
  AuthError,
  beginLogin,
  sendSms,
  submitSmsCode,
  type AuthedSession,
  type PendingLogin,
  type StoredCookie,
} from '../icloud/appleAuth.js';
import { isProfileBusy, openPage, refreshSession } from '../icloud/browser.js';
import { HmeClient, type HmeSession } from '../icloud/hme.js';
import {
  deleteConfigsForAccount,
  pickConfigForAccount,
  testConfig,
  upsertForAccount,
} from './imapService.js';

export type AccountStatus = 'awaiting_code' | 'active' | 'session_expired' | 'error';

export interface AccountPublic {
  id: string;
  label: string;
  appleId: string | null;
  dsid: string | null;
  webserviceUrl: string | null;
  china: boolean;
  status: AccountStatus;
  lastError: string | null;
  hasPassword: boolean;
  autoCreateEnabled: boolean;
  disabled: boolean;
  hasImap: boolean;
  imapUsername: string | null;
  imapAuthFailed: boolean;
  createdAt: number;
  updatedAt: number;
}

interface AccountRow {
  id: string;
  label: string;
  apple_id: string | null;
  dsid: string | null;
  webservice_url: string | null;
  client_id: string;
  china: number;
  auto_create_enabled: number;
  disabled: number;
  status: AccountStatus;
  cookie_enc: string | null;
  session_cookies_enc: string | null;
  login_password_enc: string | null;
  trust_token_enc: string | null;
  profile_dir: string | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
  has_imap?: number;
  imap_username?: string | null;
  imap_auth_failed?: number;
}

// Every account read pulls whether an IMAP mailbox is linked (+ its username +
// whether its last connection failed authentication).
const IMAP_COLS =
  'EXISTS(SELECT 1 FROM imap_configs WHERE account_id = accounts.id) AS has_imap, ' +
  '(SELECT username FROM imap_configs WHERE account_id = accounts.id ORDER BY created_at LIMIT 1) AS imap_username, ' +
  '(SELECT auth_failed FROM imap_configs WHERE account_id = accounts.id ORDER BY created_at LIMIT 1) AS imap_auth_failed';

function toPublic(row: AccountRow): AccountPublic {
  return {
    id: row.id,
    label: row.label,
    appleId: row.apple_id,
    dsid: row.dsid,
    webserviceUrl: row.webservice_url,
    china: row.china === 1,
    status: row.status,
    lastError: row.last_error,
    hasPassword: row.login_password_enc != null,
    autoCreateEnabled: row.auto_create_enabled === 1,
    disabled: row.disabled === 1,
    hasImap: row.has_imap === 1,
    imapUsername: row.imap_username ?? null,
    imapAuthFailed: row.imap_auth_failed === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getRow(id: string): AccountRow | undefined {
  return getDb()
    .prepare(`SELECT *, ${IMAP_COLS} FROM accounts WHERE id = ?`)
    .get(id) as AccountRow | undefined;
}

export function listAccounts(): AccountPublic[] {
  const rows = getDb()
    .prepare(`SELECT *, ${IMAP_COLS} FROM accounts ORDER BY created_at DESC`)
    .all() as AccountRow[];
  return rows.map(toPublic);
}

export function getAccount(id: string): AccountPublic | null {
  const row = getRow(id);
  return row ? toPublic(row) : null;
}

function setStatus(id: string, status: AccountStatus, lastError: string | null = null): void {
  getDb()
    .prepare('UPDATE accounts SET status = ?, last_error = ?, updated_at = ? WHERE id = ?')
    .run(status, lastError, Date.now(), id);
}

function storedCookies(row: AccountRow): StoredCookie[] {
  return row.session_cookies_enc ? decryptJson<StoredCookie[]>(row.session_cookies_enc) : [];
}

interface SessionFields {
  appleId: string;
  dsid: string;
  webserviceUrl: string;
  cookie: string;
  cookies: StoredCookie[];
}

/** Persist a freshly discovered/refreshed session onto an account. */
function persistSession(id: string, s: SessionFields): void {
  getDb()
    .prepare(
      `UPDATE accounts
         SET apple_id = COALESCE(NULLIF(?, ''), apple_id),
             dsid = ?, webservice_url = ?, cookie_enc = ?, session_cookies_enc = ?,
             status = 'active', last_error = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      s.appleId,
      s.dsid,
      s.webserviceUrl,
      encryptSecret(s.cookie),
      encryptJson(s.cookies),
      Date.now(),
      id,
    );
}

function persistCredentials(id: string, password: string, trustToken: string): void {
  getDb()
    .prepare(
      'UPDATE accounts SET login_password_enc = ?, trust_token_enc = ?, updated_at = ? WHERE id = ?',
    )
    .run(encryptSecret(password), trustToken ? encryptSecret(trustToken) : null, Date.now(), id);
}

/** Save an Apple ID password as soon as Apple has accepted it.
 *
 * The SMS challenge itself lives in memory and is lost when the process is
 * restarted. Keeping the already-validated password lets us create a fresh
 * challenge without asking the user for it again. Do not touch the existing
 * trust token here: it may still be useful while a replacement is pending.
 */
function persistPasswordOnly(id: string, password: string): void {
  getDb()
    .prepare('UPDATE accounts SET login_password_enc = ?, updated_at = ? WHERE id = ?')
    .run(encryptSecret(password), Date.now(), id);
}

function persistTrustTokenOnly(id: string, trustToken: string): void {
  if (!trustToken) return;
  getDb()
    .prepare('UPDATE accounts SET trust_token_enc = ?, updated_at = ? WHERE id = ?')
    .run(encryptSecret(trustToken), Date.now(), id);
}

function toSessionFields(s: AuthedSession): SessionFields {
  return { appleId: s.appleId, dsid: s.dsid, webserviceUrl: s.webserviceUrl, cookie: s.cookieHeader, cookies: s.cookies };
}

function authErrorStatus(err: AuthError): number {
  return err.code === 'bad_credentials' ? 401 : 502;
}

/** Wraps an AuthError as an HTTP-status-carrying error for route handlers. */
function rethrowAuthError(err: unknown): never {
  if (err instanceof AuthError) {
    throw Object.assign(new Error(err.message), { status: authErrorStatus(err) });
  }
  throw err;
}

export type LoginOutcome =
  | { accountId: string; status: 'active' }
  | { accountId: string; status: 'awaiting_code'; phone: string };

/** In-flight 2FA state per account, kept in memory between login and code submission. */
interface PendingEntry {
  pending: PendingLogin;
  password: string;
}
const pendingLogins = new Map<string, PendingEntry>();
const PENDING_TTL_MS = 10 * 60_000;

function takePending(accountId: string): PendingEntry {
  const entry = pendingLogins.get(accountId);
  if (!entry) {
    throw Object.assign(new Error('没有进行中的短信验证流程，请重新登录'), { status: 409 });
  }
  if (Date.now() - entry.pending.createdAt > PENDING_TTL_MS) {
    pendingLogins.delete(accountId);
    throw Object.assign(new Error('验证码流程已超时，请重新登录'), { status: 409 });
  }
  return entry;
}

function currentPending(accountId: string): PendingEntry | null {
  const entry = pendingLogins.get(accountId);
  if (!entry) return null;
  if (Date.now() - entry.pending.createdAt > PENDING_TTL_MS) {
    pendingLogins.delete(accountId);
    return null;
  }
  return entry;
}

function pendingPhone(entry: PendingEntry): string {
  const pending = entry.pending;
  return pending.phones.find((phone) => phone.id === pending.phoneId)?.display ?? `id=${pending.phoneId}`;
}

/** Finish a beginLogin() result: persist on success, or stash + send SMS. */
async function finishLogin(id: string, password: string, result: Awaited<ReturnType<typeof beginLogin>>): Promise<LoginOutcome> {
  if (result.status === 'active') {
    persistSession(id, toSessionFields(result.session));
    persistCredentials(id, password, result.session.trustToken);
    pendingLogins.delete(id);
    return { accountId: id, status: 'active' };
  }
  // Apple has already accepted these credentials. Persist them before the
  // SMS request so an app/server restart can rebuild this transient flow.
  persistPasswordOnly(id, password);
  pendingLogins.set(id, { pending: result.pending, password });
  const { phone } = await sendSms(result.pending);
  setStatus(id, 'awaiting_code');
  return { accountId: id, status: 'awaiting_code', phone };
}

export interface StartLoginInput {
  label?: string;
  appleId: string;
  password: string;
  china: boolean;
}

/**
 * Start a brand-new account via Apple's SRP-6a login (no browser). A fresh
 * client is never trusted by Apple, so this always sends an SMS code — the
 * caller must follow up with submitCode(). The row is only inserted once
 * Apple has accepted the credentials (a bad password never leaves an orphan
 * account behind).
 */
export async function startLogin(input: StartLoginInput): Promise<LoginOutcome> {
  const clientId = crypto.randomUUID();
  let result;
  try {
    result = await beginLogin({
      appleId: input.appleId,
      password: input.password,
      china: input.china,
      clientId,
    });
  } catch (err) {
    rethrowAuthError(err);
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  const profile = join(config.playwright.profilesDir, id);
  getDb()
    .prepare(
      `INSERT INTO accounts (id, label, apple_id, client_id, china, status, profile_dir, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'awaiting_code', ?, ?, ?)`,
    )
    .run(id, input.label?.trim() || input.appleId, input.appleId, clientId, input.china ? 1 : 0, profile, now, now);

  return finishLogin(id, input.password, result);
}

export interface RetryLoginInput {
  password?: string;
  china?: boolean;
}

/**
 * Re-run login for an existing account: with an explicit password (the user
 * typed a fresh one, e.g. after an Apple ID password change), or — when
 * omitted — the stored password + trust token. Apple usually accepts the
 * trust token here and skips SMS entirely.
 */
export async function retryLogin(id: string, input: RetryLoginInput = {}): Promise<LoginOutcome> {
  const row = getRow(id);
  if (!row) throw Object.assign(new Error('Account not found'), { status: 404 });
  const password = input.password ?? (row.login_password_enc ? decryptSecret(row.login_password_enc) : null);
  if (!password) {
    throw Object.assign(new Error('未保存密码，请输入 Apple ID 密码'), { status: 409 });
  }
  const china = input.china ?? row.china === 1;
  const trustToken = input.password ? null : row.trust_token_enc ? decryptSecret(row.trust_token_enc) : null;

  let result;
  try {
    result = await beginLogin({ appleId: row.apple_id ?? '', password, china, clientId: row.client_id, trustToken });
  } catch (err) {
    rethrowAuthError(err);
  }

  if (china !== (row.china === 1)) {
    getDb().prepare('UPDATE accounts SET china = ? WHERE id = ?').run(china ? 1 : 0, id);
  }
  return finishLogin(id, password, result);
}

/**
 * Resume an SMS step without sending a duplicate code when its in-memory
 * Apple context still exists. If the process restarted (or the 10-minute
 * context expired), rebuild the flow with the securely stored password.
 */
export async function resumeCode(accountId: string): Promise<LoginOutcome> {
  const entry = currentPending(accountId);
  if (entry) {
    return { accountId, status: 'awaiting_code', phone: pendingPhone(entry) };
  }
  return retryLogin(accountId);
}

/** Resend the SMS code, rebuilding a lost in-memory flow when possible. */
export async function resendCode(accountId: string): Promise<LoginOutcome> {
  const entry = currentPending(accountId);
  if (!entry) return retryLogin(accountId);
  const { phone } = await sendSms(entry.pending);
  return { accountId, status: 'awaiting_code', phone };
}

export type CodeOutcome =
  | { accountId: string; status: 'active' }
  | { accountId: string; status: 'awaiting_code'; message: string };

/** Submit the SMS code for an in-flight 2FA verification. */
export async function submitCode(accountId: string, code: string): Promise<CodeOutcome> {
  const { pending, password } = takePending(accountId);
  const r = await submitSmsCode(pending, code);
  if (!r.ok) return { accountId, status: 'awaiting_code', message: r.message };
  pendingLogins.delete(accountId);
  persistSession(accountId, toSessionFields(r.session));
  persistCredentials(accountId, password, r.session.trustToken);
  return { accountId, status: 'active' };
}

/** Where App-specific passwords are created (登录与安全 → App 专用密码). */
const APPLE_ACCOUNT_URL = 'https://account.apple.com/account/manage';

/**
 * Open a visible browser window on the account's persistent profile so the
 * user can operate Apple pages directly (default: the Apple ID management
 * page, for creating an App-specific password). The account's latest
 * captured cookies are injected first, since password-based login never
 * touches a real browser. Resolves once the window is open; it stays until
 * the user closes it.
 */
export async function openAccountPage(id: string, url?: string): Promise<{ opened: true }> {
  const row = getRow(id);
  if (!row) throw Object.assign(new Error('Account not found'), { status: 404 });
  await openPage(id, url ?? APPLE_ACCOUNT_URL, storedCookies(row));
  return { opened: true };
}

/**
 * Set the app-specific mail password for an account. Host/port default to
 * iCloud (imap.mail.me.com:993) and the username defaults to the account's
 * Apple ID, so the user only supplies the password.
 */
export function setImapPassword(accountId: string, password: string, username?: string): void {
  const row = getRow(accountId);
  if (!row) throw Object.assign(new Error('Account not found'), { status: 404 });
  const user = username?.trim() || row.apple_id;
  if (!user) {
    throw Object.assign(new Error('请先完成登录以获取邮箱地址，或手动填写用户名'), { status: 409 });
  }
  upsertForAccount(accountId, {
    label: row.label || user,
    host: 'imap.mail.me.com',
    port: 993,
    secure: true,
    username: user,
    password,
  });
}

export function clearImapPassword(accountId: string): void {
  deleteConfigsForAccount(accountId);
}

export interface AccountSettingsInput {
  label?: string;
  imapPassword?: string;
  imapUsername?: string;
  autoCreateEnabled?: boolean;
}

/**
 * One-shot save from the account editor: label, the IMAP app-specific
 * password, and/or the per-account auto-create switch. Only provided fields
 * are touched.
 */
export function updateSettings(accountId: string, input: AccountSettingsInput): AccountPublic {
  const row = getRow(accountId);
  if (!row) throw Object.assign(new Error('Account not found'), { status: 404 });
  const db = getDb();
  const label = input.label?.trim();
  if (label) {
    db.prepare('UPDATE accounts SET label = ?, updated_at = ? WHERE id = ?').run(
      label,
      Date.now(),
      accountId,
    );
  }
  if (input.autoCreateEnabled !== undefined) {
    db.prepare(
      `UPDATE accounts
          SET auto_create_enabled = ?, auto_create_failures = 0,
              auto_create_next_attempt_at = NULL, updated_at = ?
        WHERE id = ?`,
    ).run(input.autoCreateEnabled ? 1 : 0, Date.now(), accountId);
  }
  if (input.imapPassword) {
    setImapPassword(accountId, input.imapPassword, input.imapUsername);
  }
  return toPublic(getRow(accountId)!);
}

/**
 * Pause / resume an account. A disabled account is excluded from the mail
 * library and skipped by every background job (keep-alive, auto-create,
 * mark scan, sync-all). Its data and session stay intact for later re-enable.
 */
export function setDisabled(accountId: string, disabled: boolean): AccountPublic {
  const row = getRow(accountId);
  if (!row) throw Object.assign(new Error('Account not found'), { status: 404 });
  getDb()
    .prepare('UPDATE accounts SET disabled = ?, updated_at = ? WHERE id = ?')
    .run(disabled ? 1 : 0, Date.now(), accountId);
  return toPublic(getRow(accountId)!);
}

export interface RecoverResult {
  ok: boolean;
  outcome: 'cookie' | 'password' | 'busy' | 'expired' | 'awaiting_code';
  message: string;
  account: AccountPublic;
}

type SilentOutcome =
  | { outcome: 'active' }
  | { outcome: 'awaiting_code'; phone: string }
  | { outcome: 'no_password' }
  | { outcome: 'bad_password' };

/**
 * Silent SRP relogin using the stored password + trust token — no browser,
 * no user interaction. Succeeds outright when Apple still trusts this client
 * (the common case); falls back to a fresh SMS round only when the trust
 * token itself has expired, which the caller surfaces as `awaiting_code`
 * instead of a dead end.
 */
async function silentPasswordRelogin(row: AccountRow): Promise<SilentOutcome> {
  if (!row.login_password_enc) return { outcome: 'no_password' };
  const password = decryptSecret(row.login_password_enc);
  const trustToken = row.trust_token_enc ? decryptSecret(row.trust_token_enc) : null;

  let result;
  try {
    result = await beginLogin({
      appleId: row.apple_id ?? '',
      password,
      china: row.china === 1,
      clientId: row.client_id,
      trustToken,
    });
  } catch (err) {
    if (err instanceof AuthError && err.code === 'bad_credentials') {
      setStatus(row.id, 'error', 'Apple ID 密码已变更或失效，请重新输入密码登录');
      return { outcome: 'bad_password' };
    }
    throw err;
  }

  if (result.status === 'active') {
    persistSession(row.id, toSessionFields(result.session));
    persistTrustTokenOnly(row.id, result.session.trustToken);
    return { outcome: 'active' };
  }

  pendingLogins.set(row.id, { pending: result.pending, password });
  const { phone } = await sendSms(result.pending);
  setStatus(row.id, 'awaiting_code', `Apple 信任令牌已失效，需要重新验证：已发送短信验证码到 ${phone}`);
  return { outcome: 'awaiting_code', phone };
}

/**
 * On-demand session recovery: first the cheap cookie-roll fast path
 * (relaunch the persistent profile headlessly, seeded with the last captured
 * cookies), then — only if that fails — a silent password+trust-token SRP
 * relogin. Only when the trust token itself is gone does this need the user
 * to type a fresh SMS code.
 */
export async function recoverSession(accountId: string): Promise<RecoverResult> {
  const row = getRow(accountId);
  if (!row) throw Object.assign(new Error('Account not found'), { status: 404 });
  const publicNow = () => toPublic(getRow(accountId)!);

  if (isProfileBusy(accountId)) {
    return { ok: false, outcome: 'busy', message: '该账户已有登录会话进行中，请稍后再试', account: publicNow() };
  }

  const refreshed = await refreshSession(accountId, row.client_id, row.webservice_url, storedCookies(row));
  if (refreshed) {
    persistSession(accountId, refreshed);
    return { ok: true, outcome: 'cookie', message: '会话已恢复（Cookie 仍有效）', account: publicNow() };
  }

  const s = await silentPasswordRelogin(row);
  if (s.outcome === 'active') {
    return { ok: true, outcome: 'password', message: '会话已恢复（密码静默重登，无需操作）', account: publicNow() };
  }
  if (s.outcome === 'awaiting_code') {
    return {
      ok: false,
      outcome: 'awaiting_code',
      message: `Apple 信任令牌已过期：已发送短信验证码到 ${s.phone}，请在下方输入`,
      account: publicNow(),
    };
  }
  if (s.outcome === 'bad_password') {
    return {
      ok: false,
      outcome: 'expired',
      message: 'Apple ID 密码已变更，请重新输入密码登录',
      account: publicNow(),
    };
  }

  setStatus(accountId, 'session_expired', 'iCloud 会话已过期，请重新登录（未保存密码）');
  return {
    ok: false,
    outcome: 'expired',
    message: 'Cookie 已失效，无法自动恢复：请重新输入 Apple ID 密码登录',
    account: publicNow(),
  };
}

export async function testImap(accountId: string): Promise<{ ok: true }> {
  const configId = pickConfigForAccount(accountId);
  if (!configId) throw Object.assign(new Error('尚未设置邮箱密码'), { status: 409 });
  return testConfig(configId);
}

export function deleteAccount(id: string): boolean {
  const row = getRow(id);
  if (!row) return false;
  getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id);
  pendingLogins.delete(id);
  // Best-effort removal of the persistent browser profile.
  try {
    rmSync(row.profile_dir ?? join(config.playwright.profilesDir, id), {
      recursive: true,
      force: true,
    });
  } catch (err) {
    logger.warn(`failed to remove profile for account ${id}: ${String(err)}`);
  }
  return true;
}

function loadSession(row: AccountRow): HmeSession {
  if (!row.cookie_enc || !row.webservice_url || !row.dsid) {
    throw Object.assign(new Error('账户尚未登录，请先完成登录'), { status: 409 });
  }
  return {
    cookie: decryptSecret(row.cookie_enc),
    webserviceUrl: row.webservice_url,
    dsid: row.dsid,
    clientId: row.client_id,
  };
}

/**
 * Build an HME client for an account and run `fn`. If the cookie session has
 * expired, try the cookie-roll fast path and then a silent password+trust
 * SRP relogin before giving up — mirrors recoverSession(), but inline with
 * the caller's request so a normal alias operation self-heals transparently
 * whenever Apple still trusts this client. Only marks the account for manual
 * attention when both silent paths fail.
 */
export async function withHmeClient<T>(
  accountId: string,
  fn: (hme: HmeClient) => Promise<T>,
): Promise<T> {
  const row = getRow(accountId);
  if (!row) throw Object.assign(new Error('Account not found'), { status: 404 });

  try {
    return await fn(new HmeClient(loadSession(row)));
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status !== 401 && status !== 421) throw err;

    logger.info(`account ${accountId} session expired; attempting silent refresh`);
    const refreshed = await refreshSession(accountId, row.client_id, row.webservice_url, storedCookies(row));
    if (refreshed) {
      persistSession(accountId, refreshed);
      return fn(new HmeClient(loadSession(getRow(accountId)!)));
    }

    const s = await silentPasswordRelogin(row);
    if (s.outcome === 'active') {
      return fn(new HmeClient(loadSession(getRow(accountId)!)));
    }
    if (s.outcome === 'no_password') {
      setStatus(accountId, 'session_expired', 'iCloud 会话已过期，请重新登录');
    }
    // bad_password / awaiting_code already set their own status inside silentPasswordRelogin.
    throw err;
  }
}

/**
 * Cookie-only keep-alive for the session keeper: cookie-roll fast path, then
 * silent password+trust SRP relogin. Never opens windows; an account that
 * needs a fresh SMS code (trust token expired) or a fresh password (changed)
 * is left for the user to resolve, everything else self-heals in place.
 */
export async function keepAlive(
  accountId: string,
): Promise<'refreshed' | 'busy' | 'awaiting_code' | 'expired' | 'not_found'> {
  const row = getRow(accountId);
  if (!row) return 'not_found';
  if (isProfileBusy(accountId)) return 'busy';

  const refreshed = await refreshSession(accountId, row.client_id, row.webservice_url, storedCookies(row));
  if (refreshed) {
    persistSession(accountId, refreshed);
    return 'refreshed';
  }

  const s = await silentPasswordRelogin(row);
  if (s.outcome === 'active') return 'refreshed';
  if (s.outcome === 'awaiting_code') return 'awaiting_code';

  setStatus(accountId, 'session_expired', 'iCloud 会话已过期，请重新登录');
  return 'expired';
}
