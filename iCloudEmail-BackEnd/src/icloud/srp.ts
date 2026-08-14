/*
 * Apple GSA-flavoured SRP-6a client (pure Node crypto, no network).
 *
 * Ported verbatim from the reference Python implementation, which itself
 * mirrors Apple's web `webSRPClientWorker.js`:
 *   - SHA-256 hash, RFC 5054 2048-bit safe-prime group, g = 2
 *   - password derivation: s2k = PBKDF2(SHA256(pwd)),
 *                          s2k_fo = PBKDF2(hex(SHA256(pwd)))
 *   - x = H(salt | H(":" + derived))  — empty username, colon kept
 *   - K = H(PAD(S)); A/B in M1/M2 are left-padded to N's byte length (256);
 *     the account name in H(I) is lower-cased.
 *
 * `selftest()` mock-runs the server side to prove M1/M2/K all agree.
 */
import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto';

const N_HEX =
  'AC6BDB41324A9A9BF166DE5E1389582FAF72B6651987EE07FC3192943DB56050' +
  'A37329CBB4A099ED8193E0757767A13DD52312AB4B03310DCD7F48A9DA04FD50' +
  'E8083969EDB767B0CF6095179A163AB3661A05FBD5FAAAE82918A9962F0B93B8' +
  '55F97993EC975EEAA80D740ADBF4FF747359D041D5C33EA71D281E446B14773B' +
  'CA97B43A23FB801676BD207A436C6481F1D2B9078717461A5B9D32E688F87748' +
  '544523B524B0D57D5EA77A2775D2ECFA032CFBDBF52FB3786160279004E57AE6' +
  'AF874E7303CE53299CCC041C7BC308D82A5698F3A8D0C38271AE35F8E9DBFBB6' +
  '94B5C803D89F7AE435DE236D525F54759B65E372FCD68EF20FA7111F9E4AFF73';

const N = BigInt('0x' + N_HEX);
const g = 2n;
const WIDTH = (N.toString(2).length + 7) >> 3; // 256 bytes

/** BigInt → minimal big-endian bytes. */
export function toBytes(n: bigint): Buffer {
  if (n === 0n) return Buffer.from([0]);
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  return Buffer.from(hex, 'hex');
}

/** Left-pad to N's byte length (256). */
export function pad(b: Buffer): Buffer {
  if (b.length >= WIDTH) return b;
  return Buffer.concat([Buffer.alloc(WIDTH - b.length), b]);
}

function bytesToBig(buf: Buffer): bigint {
  let x = 0n;
  for (const byte of buf) x = (x << 8n) | BigInt(byte);
  return x;
}

function sha(...parts: Buffer[]): Buffer {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
}

function hint(...parts: Buffer[]): bigint {
  return bytesToBig(sha(...parts));
}

/** Byte-wise XOR of two equal-length buffers. */
function xorBytes(a: Buffer, b: Buffer): Buffer {
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i]! ^ b[i]!;
  return out;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

/** Random scalar in [1, N-1], mirroring Python's secrets.randbelow(N-1)+1. */
function randomScalar(): bigint {
  return (bytesToBig(randomBytes(256)) % (N - 1n)) + 1n;
}

/** Apple s2k / s2k_fo password derivation → 32-byte key. */
export function derivePassword(
  password: string,
  salt: Buffer,
  iterations: number,
  protocol: string,
): Buffer {
  let pw: Buffer = createHash('sha256').update(Buffer.from(password, 'utf8')).digest();
  if (protocol === 's2k_fo') pw = Buffer.from(pw.toString('hex'), 'ascii');
  return pbkdf2Sync(pw, salt, iterations, 32, 'sha256');
}

/** SRP client: generates public A, then M1/M2 proofs from the server challenge. */
export class AppleSRP {
  readonly A: bigint;
  private readonly I: Buffer;
  private readonly a: bigint;
  private readonly k: bigint;
  M1: Buffer | null = null;
  M2: Buffer | null = null;
  K: Buffer | null = null;

  constructor(accountName: string) {
    this.I = Buffer.from(accountName.toLowerCase(), 'utf8');
    this.a = randomScalar();
    this.A = modPow(g, this.a, N);
    this.k = hint(toBytes(N), pad(toBytes(g)));
  }

  processChallenge(salt: Buffer, B: bigint, derived: Buffer): Buffer {
    if (B % N === 0n) throw new Error('服务器返回的 B 非法');
    const aPad = pad(toBytes(this.A));
    const bPad = pad(toBytes(B));
    const u = hint(aPad, bPad); // u = H(PAD(A) | PAD(B))
    const x = hint(salt, sha(Buffer.concat([Buffer.from(':'), derived]))); // H(salt | H(":"+derived))
    const kgx = (this.k * modPow(g, x, N)) % N;
    let t = (B - kgx) % N;
    if (t < 0n) t += N;
    const S = modPow(t, this.a + u * x, N); // S = (B - k*g^x)^(a+u*x)
    this.K = sha(pad(toBytes(S))); // K = H(PAD(S))
    // M1 = H( (H(N) xor H(PAD(g))) | H(I) | salt | PAD(A) | PAD(B) | K )
    const hN = sha(toBytes(N));
    const hg = sha(pad(toBytes(g)));
    const hxor = xorBytes(hN, hg);
    this.M1 = sha(hxor, sha(this.I), salt, aPad, bPad, this.K);
    this.M2 = sha(aPad, this.M1, this.K); // M2 = H(PAD(A) | M1 | K)
    return this.M1;
  }
}

/** Mock-run the server side to verify the implementation is self-consistent. */
export function selftest(): boolean {
  const account = 'tester@example.com';
  const password = 'S3cr3t-Passw0rd!';
  const salt = randomBytes(16);
  const iterations = 20000;
  const derived = derivePassword(password, salt, iterations, 's2k');

  const cli = new AppleSRP(account);
  const aPad = pad(toBytes(cli.A));
  const k = hint(toBytes(N), pad(toBytes(g)));
  const x = hint(salt, sha(Buffer.concat([Buffer.from(':'), derived])));
  const v = modPow(g, x, N);
  const b = randomScalar();
  const B = (k * v + modPow(g, b, N)) % N;
  const bPad = pad(toBytes(B));
  const m1 = cli.processChallenge(salt, B, derived);

  const u = hint(aPad, bPad);
  const sServer = modPow((cli.A * modPow(v, u, N)) % N, b, N);
  const kServer = sha(pad(toBytes(sServer)));
  const hN = sha(toBytes(N));
  const hg = sha(pad(toBytes(g)));
  const hxor = xorBytes(hN, hg);
  const m1Server = sha(hxor, sha(Buffer.from(account.toLowerCase(), 'utf8')), salt, aPad, bPad, kServer);
  const m2Server = sha(aPad, m1Server, kServer);

  return Boolean(cli.K?.equals(kServer)) && m1.equals(m1Server) && Boolean(cli.M2?.equals(m2Server));
}
