import assert from 'node:assert/strict';
import test from 'node:test';
import { bestCode, extractCodes } from '../src/imap/codeExtractor.js';
import { extractLinks } from '../src/imap/linkExtractor.js';

test('verification-code extraction ranks contextual six-digit codes first', () => {
  const subject = 'Your verification code is 123456';
  const body = 'Requested in 2026. If this was not you, ignore this message.';
  assert.equal(bestCode(subject, body), '123456');
  assert.equal(
    extractCodes(subject, body).some((item) => item.code === '2026'),
    false,
  );
});

test('grouped codes are normalized and deduplicated', () => {
  const codes = extractCodes('Security code 123-456', 'Use 123 456 to continue.');
  assert.deepEqual(
    codes.map((item) => item.code),
    ['123456'],
  );
});

test('action links are retained while footer and asset links are removed', () => {
  const links = extractLinks(
    'Confirm your account',
    'Continue at https://example.com/verify?token=abc',
    '<a href="https://example.com/verify?token=abc">Verify account</a>' +
      '<a href="https://example.com/privacy">Privacy</a>' +
      '<a href="https://example.com/logo.png">Logo</a>',
  );
  assert.equal(links[0]?.url, 'https://example.com/verify?token=abc');
  assert.equal(
    links.some((item) => item.url.includes('/privacy')),
    false,
  );
  assert.equal(
    links.some((item) => item.url.includes('logo.png')),
    false,
  );
});
