import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

// Field-level encryption for sensitive columns (iCloud passwords, session
// cookies, IMAP passwords). AES-256-GCM with a random per-value IV. The
// symmetric key is derived once from SECRET_MASTER_KEY.
const KEY = createHash('sha256').update(config.secretMasterKey, 'utf8').digest();
const IV_LENGTH = 12;
const PREFIX = 'enc.v1';

/** Encrypt a UTF-8 string. Returns `enc.v1.<iv>.<tag>.<ciphertext>` (base64url parts). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(
    '.',
  );
}

/** Decrypt a value produced by {@link encryptSecret}. */
export function decryptSecret(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 5 || `${parts[0]}.${parts[1]}` !== PREFIX) {
    throw new Error('Malformed encrypted payload');
  }
  const iv = Buffer.from(parts[2]!, 'base64url');
  const tag = Buffer.from(parts[3]!, 'base64url');
  const ciphertext = Buffer.from(parts[4]!, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Serialize + encrypt any JSON-serializable value. */
export function encryptJson(value: unknown): string {
  return encryptSecret(JSON.stringify(value));
}

/** Decrypt + parse a JSON value produced by {@link encryptJson}. */
export function decryptJson<T>(payload: string): T {
  return JSON.parse(decryptSecret(payload)) as T;
}

/** SHA-256 hash (hex) — used to store API keys so plaintext is never persisted. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time comparison of two hex strings of equal length. */
export function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Generate a URL-safe random token (used for API keys / client identifiers). */
export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}
