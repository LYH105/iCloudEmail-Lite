/*
 * Apple runs two parallel iCloud web environments: international
 * (icloud.com / setup.icloud.com) and China mainland (icloud.com.cn /
 * setup.icloud.com.cn). Cookies and webservices never cross between them, so
 * every endpoint here is resolved at runtime from whichever environment the
 * session actually lives in — ICLOUD_LOGIN_URL only picks the page the login
 * window opens first; the user is free to end up on either portal.
 */

/**
 * Setup/validate base for the environment a page belongs to, or null when the
 * page is on neither portal (e.g. mid-redirect on idmsa.apple.com).
 */
export function setupBaseForPage(pageUrl: string): string | null {
  try {
    const host = new URL(pageUrl).hostname;
    if (host === 'icloud.com.cn' || host.endsWith('.icloud.com.cn')) {
      return 'https://setup.icloud.com.cn';
    }
    if (host === 'icloud.com' || host.endsWith('.icloud.com')) {
      return 'https://setup.icloud.com';
    }
    return null;
  } catch {
    return null;
  }
}

/** Session probe URL on the given setup base. */
export function validateUrlFor(setupBase: string): string {
  return `${setupBase}/setup/ws/1/validate`;
}

/**
 * Web-app origin matching an account's discovered webservice URL — sent as
 * Origin/Referer on server-side HME calls so they mirror the real client of
 * that environment.
 */
export function originForWebservice(webserviceUrl: string): string {
  try {
    const host = new URL(webserviceUrl).hostname;
    if (host === 'icloud.com.cn' || host.endsWith('.icloud.com.cn')) {
      return 'https://www.icloud.com.cn';
    }
  } catch {
    /* fall through to the international default */
  }
  return 'https://www.icloud.com';
}

/** UA for server-side HME calls — a current desktop Chrome, matching the login browser. */
export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
