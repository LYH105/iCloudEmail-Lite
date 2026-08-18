import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SECRET_MASTER_KEY = 'unit-test-master-key-0123456789';

const { decryptJson, decryptSecret, encryptJson, encryptSecret, safeEqualHex, sha256Hex } =
  await import('../src/crypto/secrets.js');

test('AES-GCM encrypts and authenticates strings', () => {
  const encrypted = encryptSecret('sensitive value');
  assert.notEqual(encrypted, 'sensitive value');
  assert.equal(decryptSecret(encrypted), 'sensitive value');

  const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith('A') ? 'B' : 'A'}`;
  assert.throws(() => decryptSecret(tampered));
});

test('encrypted JSON round-trips', () => {
  const value = { cookie: 'abc', nested: [1, true, null] };
  assert.deepEqual(decryptJson(encryptJson(value)), value);
});

test('API-key hashes compare safely', () => {
  const hash = sha256Hex('ihme_example');
  assert.equal(safeEqualHex(hash, hash), true);
  assert.equal(safeEqualHex(hash, sha256Hex('ihme_other')), false);
  assert.equal(safeEqualHex(hash, '00'), false);
});
