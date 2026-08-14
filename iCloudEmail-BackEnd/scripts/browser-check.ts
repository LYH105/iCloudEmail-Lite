/* Verify Playwright can launch the configured browser channel on this host. */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const channel =
  process.env.PLAYWRIGHT_CHANNEL ??
  (process.platform === 'win32' ? 'msedge' : process.platform === 'darwin' ? 'chrome' : '');
const dir = mkdtempSync(join(tmpdir(), 'ihme-browser-'));

console.log(`Launching channel="${channel || 'bundled chromium'}" headless...`);
try {
  const ctx = await chromium.launchPersistentContext(dir, {
    headless: true,
    ...(channel ? { channel } : {}),
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto('about:blank');
  console.log(`OK: browser launched. userAgent = ${await page.evaluate(() => navigator.userAgent)}`);
  await ctx.close();
  console.log('Browser closed cleanly. ✓');
} catch (err) {
  console.error('FAILED to launch browser:', err instanceof Error ? err.message : err);
  process.exit(1);
}
