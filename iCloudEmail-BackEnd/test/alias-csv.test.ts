import assert from 'node:assert/strict';
import test from 'node:test';
import { aliasesToCsv } from '../../iCloudEmail-FrontEnd/src/aliasCsv.js';
import type { AliasPublic } from '../../iCloudEmail-FrontEnd/src/types.js';

const alias: AliasPublic = {
  id: 'alias-1',
  accountId: 'account-1',
  anonymousId: 'anonymous-1',
  hme: 'demo@icloud.com',
  domain: 'icloud.com',
  forwardToEmail: 'owner@example.com',
  label: '测试, "邮箱"',
  note: '=HYPERLINK("https://example.test")',
  origin: null,
  isActive: true,
  recipientMailId: null,
  createTimestamp: Date.UTC(2026, 0, 2, 3, 4, 5),
  syncedAt: 0,
  marks: [{ mark: '已注册', hitAt: 0, source: null }],
  used: false,
  usedAt: null,
};

test('alias CSV is Excel-friendly, escaped, and formula-safe', () => {
  const csv = aliasesToCsv([alias], [{ id: 'account-1', appleId: 'owner@icloud.com' }]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /"测试, ""邮箱"""/);
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.test""\)"/);
  assert.match(csv, /2026-01-02T03:04:05\.000Z/);
  assert.match(csv, /owner@icloud\.com/);
});
