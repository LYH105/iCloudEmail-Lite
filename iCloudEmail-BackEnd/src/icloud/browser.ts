/*
 * Playwright-backed pieces of iCloud session handling that still need a real
 * browser: (1) a cheap headless cookie-roll to keep an already-valid session
 * fresh (`refreshSession`), and (2) a visible window on the account's signed-
 * in profile for the user to operate Apple pages directly (`openPage`, e.g.
 * to create an App-specific password). Interactive SRP login itself lives in
 * `appleAuth.ts` and never touches a browser.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { StoredCookie } from './appleAuth.js';
import { originForWebservice, setupBaseForPage, validateUrlFor } from './constants.js';
import type { ValidateResponse } from './types.js';

/** Everything needed to talk to the HME API on behalf of an account. */
export interface DiscoveredSession {
  appleId: string;
  dsid: string;
  webserviceUrl: string;
  cookie: string;
  /** Full raw cookie jar (all captured domains) — for injecting into a browser profile. */
  cookies: StoredCookie[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A persistent profile can only be opened by one browser at a time, so every
 * launch (interactive or headless) holds this in-process lock.
 */
const busyProfiles = new Set<string>();

export function isProfileBusy(accountId: string): boolean {
  return busyProfiles.has(accountId);
}

function profileDir(accountId: string): string {
  const dir = join(config.playwright.profilesDir, accountId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function launch(accountId: string, headless: boolean): Promise<BrowserContext> {
  const channel = config.playwright.channel;
  return chromium.launchPersistentContext(profileDir(accountId), {
    headless,
    ...(channel ? { channel } : {}),
    viewport: { width: 1280, height: 860 },
  });
}

/**
 * Probe the signed-in state by calling `validate` from inside the page. Runs
 * on the icloud.com(.cn) origin so the browser attaches the session cookies.
 * The setup endpoint is picked per-poll from wherever the page currently is,
 * so both the international and the China-mainland portal work — even if the
 * user navigates from one to the other inside the login window. Returns null
 * while not signed in, mid-navigation, or on a non-iCloud page.
 */
async function validateInPage(page: Page, clientId: string): Promise<ValidateResponse | null> {
  const setupBase = setupBaseForPage(page.url());
  if (!setupBase) return null;
  try {
    return (await page.evaluate(
      async (args) => {
        const qs = new URLSearchParams({
          clientBuildNumber: args.clientBuildNumber,
          clientMasteringNumber: args.clientMasteringNumber,
          clientId: args.clientId,
        });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), args.timeoutMs);
        try {
          const res = await fetch(`${args.url}?${qs.toString()}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'text/plain' },
            signal: controller.signal,
          });
          if (!res.ok) return null;
          return (await res.json()) as unknown;
        } finally {
          clearTimeout(timer);
        }
      },
      {
        url: validateUrlFor(setupBase),
        clientBuildNumber: config.icloud.clientBuildNumber,
        clientMasteringNumber: config.icloud.clientMasteringNumber,
        clientId,
        timeoutMs: 15_000,
      },
    )) as ValidateResponse | null;
  } catch {
    // Navigation destroyed the execution context, page closed, CORS hiccup…
    // — all just mean "not ready yet".
    return null;
  }
}

/** Pull dsid + premiummailsettings URL out of a validate response, if present. */
function extractSession(
  v: ValidateResponse,
): Pick<DiscoveredSession, 'appleId' | 'dsid' | 'webserviceUrl'> | null {
  const dsid = v.dsInfo?.dsid != null ? String(v.dsInfo.dsid) : '';
  const webserviceUrl = v.webservices?.['premiummailsettings']?.url ?? '';
  if (!dsid || !webserviceUrl) return null;
  return {
    appleId: v.dsInfo?.appleId ?? v.dsInfo?.primaryEmail ?? '',
    dsid,
    webserviceUrl,
  };
}

/** Serialize the context's iCloud cookies into a Cookie request header. */
async function cookieHeader(ctx: BrowserContext): Promise<string> {
  const cookies = await ctx.cookies();
  return cookies
    .filter((c) => c.domain.includes('icloud.com'))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

/** Full raw cookie jar (all domains) from the context, in our storage shape. */
async function rawCookies(ctx: BrowserContext): Promise<StoredCookie[]> {
  const cookies = await ctx.cookies();
  return cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain.replace(/^\./, ''),
    path: c.path,
    secure: c.secure,
    expires: c.expires > 0 ? Math.floor(c.expires) : null,
    hostOnly: !c.domain.startsWith('.'),
  }));
}

/** Seed a persistent profile with a previously-captured cookie jar (e.g. from SRP login). */
async function injectCookies(ctx: BrowserContext, cookies: StoredCookie[]): Promise<void> {
  if (cookies.length === 0) return;
  await ctx.addCookies(
    cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.hostOnly ? c.domain : `.${c.domain}`,
      path: c.path,
      secure: c.secure,
      expires: c.expires ?? -1,
    })),
  );
}

/**
 * Open a visible browser window on the account's persistent profile and leave
 * it to the user — e.g. to create an App-specific password on
 * account.apple.com while reusing the signed-in session. `cookies` (the
 * account's latest captured jar, from SRP login or a prior refresh) is
 * injected before navigating, since the profile itself was never visited by
 * a real browser under the password-login flow. Resolves as soon as the
 * window is open; the profile stays locked (login/refresh blocked) until the
 * user closes the window, which releases the lock automatically.
 */
export async function openPage(accountId: string, url: string, cookies: StoredCookie[] = []): Promise<void> {
  if (busyProfiles.has(accountId)) {
    throw Object.assign(new Error('该账户的浏览器已在使用中（登录 / 刷新 / 已打开的页面），请先关闭'), {
      status: 409,
    });
  }
  busyProfiles.add(accountId);
  let ctx: BrowserContext;
  try {
    ctx = await launch(accountId, false);
  } catch (err) {
    busyProfiles.delete(accountId);
    throw err;
  }
  ctx.on('close', () => busyProfiles.delete(accountId));
  try {
    await injectCookies(ctx, cookies);
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    // Slow loads are fine — from here the window belongs to the user.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  } catch (err) {
    logger.warn(`openPage(${accountId}) navigation: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Cookie-only silent refresh: relaunch the account's persistent profile
 * headlessly, seed it with the last captured cookie jar (the profile itself
 * is never visited by a real browser under the password-login flow), let
 * iCloud roll the session cookies forward, and re-extract the session.
 * Returns null when the cookies are no longer valid (the caller falls back
 * to a password-based SRP relogin). Never types passwords, never shows UI.
 *
 * `webserviceUrl` (the account's discovered service address) tells us which
 * environment the session lives in, so the refresh opens the matching portal
 * — icloud.com or icloud.com.cn — instead of the configured login page.
 */
export async function refreshSession(
  accountId: string,
  clientId: string,
  webserviceUrl?: string | null,
  cookies: StoredCookie[] = [],
): Promise<DiscoveredSession | null> {
  if (busyProfiles.has(accountId)) return null;
  busyProfiles.add(accountId);
  let ctx: BrowserContext | null = null;
  try {
    ctx = await launch(accountId, true);
    await injectCookies(ctx, cookies);
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    const portal = webserviceUrl ? `${originForWebservice(webserviceUrl)}/` : config.icloud.loginUrl;
    await page.goto(portal, { waitUntil: 'domcontentloaded', timeout: 45_000 });

    // A still-valid session usually validates on the first or second probe;
    // a few retries absorb slow cookie rolling after the app boots.
    for (let attempt = 0; attempt < 4; attempt++) {
      const v = await validateInPage(page, clientId);
      const base = v ? extractSession(v) : null;
      if (base) {
        return { ...base, cookie: await cookieHeader(ctx), cookies: await rawCookies(ctx) };
      }
      await sleep(2000);
    }
    return null;
  } catch (err) {
    logger.warn(`refreshSession(${accountId}) failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    if (ctx) await ctx.close().catch(() => undefined);
    busyProfiles.delete(accountId);
  }
}
