/*
 * Exercise the SRP-based password-login pipeline WITHOUT real credentials: a
 * bogus Apple ID/password against the real idmsa.apple.com. Expected outcome:
 * a 401 (bad_credentials) AuthError — proving the whole SRP handshake
 * (signin/init → signin/complete) is wired correctly end to end.
 * Run: npx tsx scripts/login-flow-check.ts
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'ihme-login-'));
process.env.NODE_ENV = 'test';
process.env.SECRET_MASTER_KEY = 'login-flow-check-master-key-0000';
process.env.DATABASE_PATH = join(base, 'test.sqlite');
process.env.PROFILES_DIR = join(base, 'profiles');
process.env.LOG_LEVEL = 'error';

const { getDb } = await import('../src/db/index.js');
getDb();
const accounts = await import('../src/services/accountService.js');

console.log('Starting SRP login with bogus credentials against idmsa.apple.com...');
try {
  await accounts.startLogin({
    appleId: 'not-a-real-account@icloud.com',
    password: 'wrong-password-0000',
    china: true,
  });
  console.error('  ✗ expected a bad_credentials error, but login did not throw');
  process.exit(1);
} catch (err) {
  const status = (err as { status?: number }).status;
  const ok = status === 401;
  console.log(`  caught error (status=${status}): ${err instanceof Error ? err.message : err}`);
  console.log(
    ok
      ? '✓ SRP pipeline wired correctly (signin/init → signin/complete → 401 bad_credentials)'
      : '✗ unexpected error/status',
  );
  process.exit(ok ? 0 : 1);
}
