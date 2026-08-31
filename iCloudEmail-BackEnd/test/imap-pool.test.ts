import assert from 'node:assert/strict';
import test from 'node:test';
import {
  connectionPoolKey,
  MAX_FETCH_SOURCE_BYTES,
  MAX_MESSAGE_SOURCE_BYTES,
  selectUidsWithinBudget,
  type ImapConnectionConfig,
} from '../src/imap/client.js';

const base: ImapConnectionConfig = {
  host: 'imap.example.test',
  port: 993,
  secure: true,
  username: 'user@example.test',
  password: 'old-password',
};

test('IMAP pool identity changes with credentials and transport security', () => {
  const original = connectionPoolKey(base);
  assert.notEqual(connectionPoolKey({ ...base, password: 'new-password' }), original);
  assert.notEqual(connectionPoolKey({ ...base, secure: false }), original);
  assert.equal(connectionPoolKey({ ...base }), original);
  assert.ok(!original.includes(base.password), 'pool key must not expose the password');
});

test('mail source parsing has a conservative per-message memory bound', () => {
  assert.equal(MAX_MESSAGE_SOURCE_BYTES, 2 * 1024 * 1024);
});

test('mail selection enforces an aggregate source budget and prefers recent messages', () => {
  const oneMiB = 1024 * 1024;
  const sizes = new Map([
    [1, oneMiB],
    [2, oneMiB],
    [3, oneMiB],
    [4, 3 * oneMiB], // over the per-message cap
  ]);
  assert.deepEqual(selectUidsWithinBudget([1, 2, 3, 4], sizes, 10, 2 * oneMiB), [2, 3]);
  assert.equal(MAX_FETCH_SOURCE_BYTES, 24 * oneMiB);
});
