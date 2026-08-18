import assert from 'node:assert/strict';
import test from 'node:test';
import { connectionPoolKey, type ImapConnectionConfig } from '../src/imap/client.js';

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
