import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { expiryFromNow, isExpired } from "./tokens";

/**
 * Two deliberately different layers.
 *
 * Account lockout is DB-backed — same reasoning schema.ts already gives for
 * sessions being rows and not JWTs: this state has to survive a restart and
 * be authoritative. The IP throttle is an in-memory Map instead, because
 * grader runs as a single Node process under systemd --user (see
 * scripts/deploy-remote.sh) — no cluster, no multiple instances. A restart
 * clearing it is an accepted tradeoff: the account-level lockout is the
 * durable backstop, and a restart isn't something an attacker controls the
 * timing of.
 */
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

const IP_WINDOW_MS = 5 * 60 * 1000;
const IP_MAX_ATTEMPTS = 20; // generous: a shared studio-LAN NAT'd IP must not lock out a whole room

const ipAttempts = new Map<string, { count: number; windowStart: number }>();

export function isIpThrottled(ip: string | null): boolean {
  if (!ip) return false;
  const entry = ipAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.windowStart > IP_WINDOW_MS) {
    ipAttempts.delete(ip);
    return false;
  }
  return entry.count >= IP_MAX_ATTEMPTS;
}

export function recordIpFailure(ip: string | null): void {
  if (!ip) return;
  const entry = ipAttempts.get(ip);
  const now = Date.now();
  if (!entry || now - entry.windowStart > IP_WINDOW_MS) {
    ipAttempts.set(ip, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
  }
}

export function isLockedOut(user: { lockedUntil: string | null }): boolean {
  return !!user.lockedUntil && !isExpired(user.lockedUntil);
}

/** Increments the failure counter, locking the account once the threshold is hit. */
export async function recordFailedLogin(userId: number): Promise<void> {
  await db
    .update(users)
    .set({ failedLoginAttempts: sql`${users.failedLoginAttempts} + 1` })
    .where(eq(users.id, userId));

  const [row] = await db
    .select({ failedLoginAttempts: users.failedLoginAttempts })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if ((row?.failedLoginAttempts ?? 0) >= MAX_FAILED_LOGIN_ATTEMPTS) {
    await db
      .update(users)
      .set({ lockedUntil: expiryFromNow(LOCKOUT_DURATION_MS) })
      .where(eq(users.id, userId));
  }
}

export async function resetFailedLogins(userId: number): Promise<void> {
  await db.update(users).set({ failedLoginAttempts: 0, lockedUntil: null }).where(eq(users.id, userId));
}
