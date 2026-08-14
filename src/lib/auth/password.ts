import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Password hashing with scrypt from node:crypto.
 *
 * Deliberately not argon2id, which is marginally stronger but costs a compiled
 * native dependency. scrypt is memory-hard, built in, and has no supply chain.
 *
 * Note that the studio LAN runs over plain HTTP for now. That is a reason to
 * store credentials carefully, not a licence to store them casually: the
 * trusted network is why there is no TLS, and it will stop being true when this
 * moves to a departmental server.
 */

const N = 16384; // CPU/memory cost
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/** NIST's guidance is length over composition rules, so that is what this does. */
export const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

export function passwordProblem(password: string): string | null {
  if (typeof password !== "string" || password.length === 0) return "Enter a password.";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters. Length matters more than punctuation — a short phrase you can remember beats a mangled word.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) return `Keep it under ${MAX_PASSWORD_LENGTH} characters.`;
  if (password.trim().length === 0) return "A password of only spaces will be impossible to type reliably.";
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt);
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

/**
 * Constant-time verification.
 *
 * Returns false rather than throwing for every malformed input, including a
 * null hash — a user who has been invited but has not set a password yet must
 * fail the same way as a wrong password, not crash the login route.
 */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored || typeof stored !== "string") return false;

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64");
    expected = Buffer.from(parts[5], "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = await derive(password, salt, { n, r, p, keyLength: expected.length });
  } catch {
    return false;
  }

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function derive(
  password: string,
  salt: Buffer,
  opts: { n?: number; r?: number; p?: number; keyLength?: number } = {},
): Promise<Buffer> {
  const keyLength = opts.keyLength ?? KEY_LENGTH;
  const cost = opts.n ?? N;
  const blockSize = opts.r ?? R;
  const parallelization = opts.p ?? P;

  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      keyLength,
      // maxmem must be raised above the default 32 MB to accommodate N=16384.
      { N: cost, r: blockSize, p: parallelization, maxmem: 256 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key as Buffer)),
    );
  });
}
