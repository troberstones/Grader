import { createHash, randomBytes } from "node:crypto";

/**
 * Opaque tokens for sessions and invitations.
 *
 * The token itself goes to the browser — in a cookie, or in an invitation link
 * — and only its SHA-256 is stored. Read access to the database is therefore
 * not the same thing as the ability to forge a session, which is the kind of
 * property that is never successfully retrofitted.
 *
 * SHA-256 with no salt or stretching is correct here and would be wrong for a
 * password: these are 256 bits of machine-generated randomness, so there is no
 * guessable input for an attacker to iterate over.
 */

const TOKEN_BYTES = 32;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** ISO-ish timestamp in the format SQLite's `datetime('now')` produces. */
export function sqlTimestamp(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

export function expiryFromNow(ms: number, now: Date = new Date()): string {
  return sqlTimestamp(new Date(now.getTime() + ms));
}

/**
 * Is this stored expiry in the past?
 *
 * Stored timestamps are UTC without a zone marker, which `new Date()` would
 * interpret as local time, so the Z is appended before comparing.
 */
export function isExpired(expiresAt: string, now: Date = new Date()): boolean {
  const parsed = Date.parse(expiresAt.replace(" ", "T") + "Z");
  if (Number.isNaN(parsed)) return true;
  return parsed <= now.getTime();
}

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const UPLOAD_LINK_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

/**
 * A session older than this gets its expiry pushed out on use, so an active
 * user is not logged out mid-term. Refreshing on every request would mean a
 * database write on every page view for no benefit.
 */
export const SESSION_REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
