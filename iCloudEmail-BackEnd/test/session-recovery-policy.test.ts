import assert from 'node:assert/strict';
import test from 'node:test';
import { loginChallengeAction, shouldRememberPassword } from '../src/services/accountService.js';

test('only an explicit login flow may send an SMS challenge', () => {
  assert.equal(loginChallengeAction('explicit_login'), 'send_sms');
  assert.equal(loginChallengeAction('silent_recovery'), 'require_explicit_login');
});

test('password persistence remains backward compatible but honors explicit opt-out', () => {
  assert.equal(shouldRememberPassword(undefined), true);
  assert.equal(shouldRememberPassword(true), true);
  assert.equal(shouldRememberPassword(false), false);
});
