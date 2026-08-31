import assert from 'node:assert/strict';
import test from 'node:test';
import { emailContentSecurityPolicy } from '../../iCloudEmail-FrontEnd/src/emailSecurity.js';

test('email viewer blocks remote resources by default', () => {
  const policy = emailContentSecurityPolicy(false);
  assert.match(policy, /default-src 'none'/);
  assert.doesNotMatch(policy, /https:|http:/);
});

test('email viewer allows remote images only after opt-in', () => {
  const policy = emailContentSecurityPolicy(true);
  assert.match(policy, /img-src data: blob: https:/);
  assert.doesNotMatch(policy, /\bhttp:/);
  assert.match(policy, /default-src 'none'/);
});
