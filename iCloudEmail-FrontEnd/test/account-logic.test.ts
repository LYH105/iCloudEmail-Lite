import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAliasBatchInput } from '../src/features/accounts/accountLogic';

test('manual alias batch accepts configurable count and trimmed label', () => {
  assert.deepEqual(parseAliasBatchInput('12', '  注册池  '), {
    ok: true,
    count: 12,
    label: '注册池',
  });
});

test('manual alias batch rejects out-of-range or fractional counts', () => {
  for (const value of ['0', '26', '1.5', 'not-a-number']) {
    assert.equal(parseAliasBatchInput(value, '标签').ok, false);
  }
});

test('manual alias batch requires a non-empty bounded label', () => {
  assert.equal(parseAliasBatchInput('5', '   ').ok, false);
  assert.equal(parseAliasBatchInput('5', 'x'.repeat(121)).ok, false);
});
