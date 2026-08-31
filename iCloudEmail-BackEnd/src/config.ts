import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

// Load .env from the repository root first, then a server-local override.
for (const candidate of ['../.env', '.env']) {
  const path = resolve(process.cwd(), candidate);
  if (existsSync(path)) loadDotenv({ path, override: false });
}

function str(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) throw new Error(`Invalid integer for ${name}: ${raw}`);
  return parsed;
}

const nodeEnv = str('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';
const host = str('HOST', '127.0.0.1');
const authDisabled = process.env.DISABLE_AUTH === 'true';
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);

if (authDisabled && !loopbackHosts.has(host)) {
  throw new Error('DISABLE_AUTH=true is only allowed with a loopback HOST');
}

// In development we fall back to a fixed dev key so the app boots without setup.
// In production the operator MUST supply their own key.
const masterKey = process.env.SECRET_MASTER_KEY;
if (isProduction && (!masterKey || masterKey.length < 16)) {
  throw new Error('SECRET_MASTER_KEY must be set to a strong value in production');
}

export const config = {
  nodeEnv,
  isProduction,
  port: int('PORT', 8787),
  host,
  databasePath: resolve(process.cwd(), str('DATABASE_PATH', './data/icloud-hme.sqlite')),
  secretMasterKey: masterKey && masterKey.length >= 16 ? masterKey : 'dev-insecure-master-key-change-me',
  corsOrigins: str('CORS_ORIGINS', 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // When set (e.g. by the Electron shell), the built web UI is served from this
  // directory so the whole app runs same-origin on a single port.
  webDist: process.env.WEB_DIST ? resolve(process.cwd(), process.env.WEB_DIST) : undefined,
  // Local-only mode: skip API-key auth entirely (the desktop app sets this).
  authDisabled,
  // Electron provides a fresh per-launch value and installs it as an HttpOnly,
  // SameSite cookie. This keeps desktop mode keyless for the user without
  // granting every process on the machine unauthenticated API access.
  desktopInstanceId: process.env.DESKTOP_INSTANCE_ID || undefined,
  // How often (minutes) the session keeper re-validates each account's
  // browser profile to keep iCloud cookies alive. 0 disables it.
  sessionRefreshMinutes: int('SESSION_REFRESH_MINUTES', 180),
  // How often (minutes) inboxes are scanned to apply alias mark rules
  // (已注册/已开通…). 0 disables the background scanner.
  markScanMinutes: int('MARK_SCAN_MINUTES', 30),
  icloud: {
    clientBuildNumber: str('ICLOUD_CLIENT_BUILD_NUMBER', '2413Project28'),
    clientMasteringNumber: str('ICLOUD_CLIENT_MASTERING_NUMBER', '2413B28'),
    // Fallback portal for the headless cookie-refresh browser when an
    // account's webserviceUrl hasn't been discovered yet.
    loginUrl: str('ICLOUD_LOGIN_URL', 'https://www.icloud.com.cn/'),
  },
  playwright: {
    // Chromium channel to launch. Defaults to the system browser so no
    // download is needed: Edge ("msedge") on Windows, Google Chrome ("chrome")
    // on macOS. Set to "chromium" (after `npx playwright install chromium`)
    // to use Playwright's bundled build instead.
    channel:
      process.env.PLAYWRIGHT_CHANNEL ??
      (process.platform === 'win32' ? 'msedge' : process.platform === 'darwin' ? 'chrome' : ''),
    // Persistent browser profiles (one per account) — keeps users signed in
    // for "打开网页" (App-specific-password creation) and the cookie-refresh
    // fast path.
    profilesDir: resolve(process.cwd(), str('PROFILES_DIR', './data/profiles')),
  },
} as const;

export type AppConfig = typeof config;
