// No `server-only` import: this module pulls in next/headers, which is already
// a build error inside a client component. The guard would be redundant.

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { hashToken, isExpired, expiryFromNow, generateToken, SESSION_TTL_MS, SESSION_REFRESH_AFTER_MS } from "./tokens";
import {
  isGlobalRole,
  isSessionMode,
  isUserStatus,
  type GlobalRole,
  type Principal,
  type SessionMode,
  type UserStatus,
} from "./roles";

export const SESSION_COOKIE = "grader_session";

/**
 * Cookie flags come from configuration rather than NODE_ENV.
 *
 * The studio LAN runs over plain HTTP during testing, and a `secure` cookie
 * would simply never be sent there. Setting SECURE_COOKIES=1 is the one change
 * needed when this moves behind TLS on a departmental server — the assumption
 * is not baked into the auth code.
 */
const SECURE_COOKIES = process.env.SECURE_COOKIES === "1";

/** Outer bound on the cookie. The session row is the authority within it. */
const COOKIE_MAX_AGE_SECONDS = 60 * 24 * 60 * 60;

export interface SessionUser extends Principal {
  name: string;
  email: string;
  netId: string | null;
}

/**
 * The signed-in user, or null.
 *
 * Wrapped in React's `cache` so that a layout, a page and three server actions
 * in one request share a single query rather than issuing five.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      createdAt: sessions.createdAt,
      id: users.id,
      name: users.name,
      email: users.email,
      netId: users.netId,
      globalRole: users.globalRole,
      status: users.status,
      canViewArchive: users.canViewArchive,
      mode: sessions.mode,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  if (isExpired(row.expiresAt)) {
    await db.delete(sessions).where(eq(sessions.id, row.sessionId));
    return null;
  }

  // A disabled account must stop working immediately, which is the whole reason
  // sessions are rows rather than JWTs. Its sessions are dropped on sight.
  if (row.status !== "active") {
    await db.delete(sessions).where(eq(sessions.userId, row.id));
    return null;
  }

  if (!isGlobalRole(row.globalRole) || !isUserStatus(row.status)) return null;

  // An unrecognised mode is treated as the restricted one. A row written by a
  // future version, or hand-edited, must not fall open into full grading
  // access — the safe direction here is fewer permissions, not more.
  const mode: SessionMode = isSessionMode(row.mode) ? row.mode : "review";

  await refreshIfStale(row.sessionId, row.expiresAt);

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    netId: row.netId,
    globalRole: row.globalRole,
    status: row.status,
    canViewArchive: row.canViewArchive === 1,
    mode,
  };
});

/**
 * Slide the expiry so an active user is not logged out mid-term.
 *
 * Only the row is touched, never the cookie: cookies cannot be written during a
 * server component render, and the row is what actually decides validity.
 */
async function refreshIfStale(sessionId: number, expiresAt: string): Promise<void> {
  const remaining = Date.parse(expiresAt.replace(" ", "T") + "Z") - Date.now();
  if (remaining > SESSION_TTL_MS - SESSION_REFRESH_AFTER_MS) return;
  await db
    .update(sessions)
    .set({ expiresAt: expiryFromNow(SESSION_TTL_MS) })
    .where(eq(sessions.id, sessionId));
}

/**
 * Issue a session and set the cookie.
 *
 * Only callable from a server action or route handler — Next.js does not permit
 * writing cookies during a render.
 */
export async function createSession(
  userId: number,
  meta: { userAgent?: string | null; ip?: string | null } = {},
  mode: SessionMode = "grade",
): Promise<void> {
  const token = generateToken();

  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt: expiryFromNow(SESSION_TTL_MS),
    userAgent: meta.userAgent?.slice(0, 400) ?? null,
    ip: meta.ip?.slice(0, 60) ?? null,
    mode,
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: SECURE_COOKIES,
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }
  jar.delete(SESSION_COOKIE);
}

/** Drop every session for a user: disabling an account, or a forced logout. */
export async function destroyAllSessions(userId: number): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

// ─── Bootstrap ──────────────────────────────────────────────────────────

/**
 * True when no account exists yet.
 *
 * The first run creates an administrator interactively rather than seeding a
 * default password. A known default on a studio LAN is worse than no
 * authentication at all, because it looks like authentication.
 */
export const needsBootstrap = cache(async (): Promise<boolean> => {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(users);
  return (row?.n ?? 0) === 0;
});

// ─── Guards ─────────────────────────────────────────────────────────────

export async function requireUser(): Promise<SessionUser> {
  if (await needsBootstrap()) redirect("/setup");
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Keep a review session out of a page that exists to evaluate somebody.
 *
 * The capability checks in `can()` are what actually stop the writes, and they
 * would stop them here too — but an action throwing "You do not have permission
 * to do that" is the wrong answer for a whole page that should simply not be
 * part of this session. Worse, the grade sheet renders scores before any action
 * is called, so refusing at the action is too late to keep them off the screen.
 *
 * `redirectTo` should be somewhere the review session can actually go, or this
 * just bounces the user into another redirect.
 */
export async function requireGradeSession(redirectTo = "/assignments"): Promise<SessionUser> {
  const user = await requireUser();
  if (user.mode === "review") redirect(redirectTo);
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.globalRole !== "admin") redirect("/");
  // Administration is `user.manage`, which `can()` refuses to every review
  // session — so the console would render controls that all fail. Bounced here
  // instead, for the same reason as requireGradeSession().
  if (user.mode === "review") redirect("/");
  return user;
}

// ─── Lookups used by the account actions ────────────────────────────────

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findUserByEmail(email: string) {
  const rows = await db.select().from(users).where(eq(users.email, normaliseEmail(email))).limit(1);
  return rows[0] ?? null;
}

/**
 * How many usable administrators exist.
 *
 * Guards the last-admin case: demoting or disabling the only active
 * administrator would lock everyone out of account management permanently,
 * with no way back in short of editing the database by hand.
 */
export async function countActiveAdmins(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(users)
    .where(and(eq(users.globalRole, "admin"), eq(users.status, "active")));
  return row?.n ?? 0;
}

export type { GlobalRole, SessionMode, UserStatus };
