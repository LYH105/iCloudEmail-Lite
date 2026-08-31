import assert from 'node:assert/strict';
import test from 'node:test';
import type { LibraryMessage } from '../src/types';
import { mailCacheStorageKey, mailMessageKey, mergeMailMessages } from '../src/features/mail/mailCacheLogic';

function message(overrides: Partial<LibraryMessage> = {}): LibraryMessage {
  return {
    uid: 1,
    accountId: 'account-1',
    alias: 'alias@icloud.com',
    from: 'sender@example.com',
    to: 'alias@icloud.com',
    subject: 'Code',
    date: '2026-08-31T00:00:00.000Z',
    text: 'old',
    html: null,
    codes: [],
    links: [],
    ...overrides,
  };
}

test('mail key separates accounts and recipient aliases', () => {
  assert.notEqual(mailMessageKey(message()), mailMessageKey(message({ accountId: 'account-2' })));
  assert.notEqual(mailMessageKey(message()), mailMessageKey(message({ alias: 'other@icloud.com' })));
});

test('merge deduplicates, lets fetched copies win, trims the time window, and sorts newest first', () => {
  const now = Date.parse('2026-08-31T12:00:00.000Z');
  const existing = [
    message({ uid: 1, date: '2026-08-31T10:00:00.000Z', text: 'old copy' }),
    message({ uid: 2, date: '2026-08-29T10:00:00.000Z' }),
  ];
  const fetched = [
    message({ uid: 1, date: '2026-08-31T10:00:00.000Z', text: 'fresh copy' }),
    message({ uid: 3, date: '2026-08-31T11:00:00.000Z' }),
  ];

  const merged = mergeMailMessages(existing, fetched, 24 * 60, now);
  assert.deepEqual(
    merged.map((item) => item.uid),
    [3, 1],
  );
  assert.equal(merged[1]?.text, 'fresh copy');
});

test('persistent cache key is explicitly namespaced', () => {
  assert.equal(mailCacheStorageKey('v1-deadbeef', '1440'), 'v1-deadbeef:1440');
});
