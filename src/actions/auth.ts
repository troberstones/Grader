"use server";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { invites, users } from "@/db/schema";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { expiryFromNow, generateToken, hashToken, isExpired, INVITE_TTL_MS, sqlTimestamp } from "@/lib/auth/tokens";
import { isGlobalRole, type GlobalRole } from "@/lib/auth/roles";
import {
  countActiveAdmins,
  createSession,
  destroyAllSessions,
  destroySession,
  findUserByEmail,
  getCurrentUser,
  needsBootstrap,
  normaliseEmail,
  requireAdmin,
} from "@/lib/auth/session";

export interface ActionResult {
  ok: boolean;
  error?: string;
  /** Set when the caller should show the invitation link to copy. */
  inviteUrl?: string;
}

const ok: ActionResult = { ok: true };
const fail = (error: string): ActionResult => ({ ok: false, error });

async function requestMeta() {
  const h = await headers();
  return {
    userAgent: h.get("user-agent"),
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  };
}

// ─── Sign in and out ────────────────────────────────────────────────────

/**
 * Failures are deliberately indistinguishable.
 *
 * "No such account" and "wrong password" are the same message, because the
 * difference tells an unauthenticated caller which email addresses are real.
 * A disabled account is the one exception worth naming, since the person
 * affected needs to know to ask an administrator rather than keep retrying.
 */
export async function signIn(email: string, password: string): Promise<ActionResult> {
  if (await needsBootstrap()) return fail("No accounts exist yet. Set up the first administrator.");

  const user = await findUserByEmail(email ?? "");

  // Always run a verification, even with no user, so that a missing account and
  // a wrong password take a comparable amount of time.
  const valid = await verifyPassword(password ?? "", user?.passwordHash ?? null);

  if (!user || !valid) return fail("That email and password do not match.");

  if (user.status === "disabled") {
    return fail("This account has been disabled. Ask an administrator to re-enable it.");
  }
  if (user.status === "invited" || !user.passwordHash) {
    return fail("This account has not been set up yet. Use the invitation link you were sent.");
  }

  await createSession(user.id, await requestMeta());
  await db.update(users).set({ lastLoginAt: sqlTimestamp(new Date()) }).where(eq(users.id, user.id));

  return ok;
}

export async function signOut(): Promise<ActionResult> {
  await destroySession();
  return ok;
}

// ─── First run ──────────────────────────────────────────────────────────

/**
 * Create the first administrator.
 *
 * Only possible while no account exists — the check is re-read here rather than
 * trusted from the page, because a page that renders is not an authorization
 * decision.
 */
export async function bootstrapAdmin(input: {
  name: string;
  email: string;
  password: string;
}): Promise<ActionResult> {
  if (!(await needsBootstrap())) return fail("An account already exists. Sign in instead.");

  const name = input.name?.trim();
  const email = normaliseEmail(input.email ?? "");

  if (!name) return fail("Enter your name.");
  if (!isEmail(email)) return fail("Enter a valid email address.");

  const problem = passwordProblem(input.password ?? "");
  if (problem) return fail(problem);

  const passwordHash = await hashPassword(input.password);

  const [created] = await db
    .insert(users)
    .values({
      name,
      email,
      passwordHash,
      globalRole: "admin",
      status: "active",
      // Creating the account signs you in, so this is a sign-in.
      lastLoginAt: sqlTimestamp(new Date()),
    })
    .returning();

  await createSession(created.id, await requestMeta());
  revalidatePath("/", "layout");
  return ok;
}

// ─── Invitations ────────────────────────────────────────────────────────

/**
 * Invite someone.
 *
 * The account row is created immediately with status `invited`, so the admin
 * list shows pending invitations rather than hiding them in a separate place.
 * The token is returned exactly once, in the URL — only its hash is stored, so
 * it cannot be shown again and a lost link needs a fresh invitation.
 */
export async function inviteUser(input: {
  name: string;
  email: string;
  globalRole: string;
}): Promise<ActionResult> {
  const admin = await requireAdmin();

  const name = input.name?.trim();
  const email = normaliseEmail(input.email ?? "");
  const role = input.globalRole;

  if (!name) return fail("Enter a name.");
  if (!isEmail(email)) return fail("Enter a valid email address.");
  if (!isGlobalRole(role)) return fail("Choose a role.");

  const existing = await findUserByEmail(email);
  if (existing && existing.status !== "invited") {
    return fail(`${email} already has an account.`);
  }

  const userId = existing
    ? (await db.update(users).set({ name, globalRole: role }).where(eq(users.id, existing.id)).returning())[0].id
    : (await db.insert(users).values({ name, email, globalRole: role, status: "invited" }).returning())[0].id;

  // Re-inviting invalidates any earlier link for the same person.
  await db.delete(invites).where(and(eq(invites.userId, userId), isNull(invites.acceptedAt)));

  const token = generateToken();
  await db.insert(invites).values({
    userId,
    tokenHash: hashToken(token),
    invitedBy: admin.id,
    expiresAt: expiryFromNow(INVITE_TTL_MS),
  });

  revalidatePath("/admin/users");
  return { ok: true, inviteUrl: `/invite/${token}` };
}

export interface InviteDetails {
  name: string;
  email: string;
  globalRole: GlobalRole;
}

/** Look up an invitation for the acceptance page. Null when unusable. */
export async function inspectInvite(token: string): Promise<InviteDetails | null> {
  if (!token) return null;

  const rows = await db
    .select({
      acceptedAt: invites.acceptedAt,
      expiresAt: invites.expiresAt,
      name: users.name,
      email: users.email,
      globalRole: users.globalRole,
      status: users.status,
    })
    .from(invites)
    .innerJoin(users, eq(users.id, invites.userId))
    .where(eq(invites.tokenHash, hashToken(token)))
    .limit(1);

  const row = rows[0];
  if (!row || row.acceptedAt || isExpired(row.expiresAt)) return null;
  if (row.status === "disabled") return null;
  if (!isGlobalRole(row.globalRole)) return null;

  return { name: row.name, email: row.email, globalRole: row.globalRole };
}

/**
 * Accept an invitation by setting a password.
 *
 * The invitation is consumed inside the same statement that checks it is
 * unconsumed, so two submissions of the same link cannot both create a session.
 */
export async function acceptInvite(token: string, input: { name?: string; password: string }): Promise<ActionResult> {
  const details = await inspectInvite(token);
  if (!details) return fail("This invitation is no longer valid. Ask for a new one.");

  const problem = passwordProblem(input.password ?? "");
  if (problem) return fail(problem);

  const claimed = await db
    .update(invites)
    .set({ acceptedAt: sqlTimestamp(new Date()) })
    .where(and(eq(invites.tokenHash, hashToken(token)), isNull(invites.acceptedAt)))
    .returning({ userId: invites.userId });

  if (claimed.length === 0) return fail("This invitation has already been used.");

  const passwordHash = await hashPassword(input.password);
  const name = input.name?.trim();

  await db
    .update(users)
    .set({
      passwordHash,
      status: "active",
      lastLoginAt: sqlTimestamp(new Date()),
      ...(name ? { name } : {}),
    })
    .where(eq(users.id, claimed[0].userId));

  await createSession(claimed[0].userId, await requestMeta());
  revalidatePath("/admin/users");
  return ok;
}

// ─── Account administration ─────────────────────────────────────────────

export async function setUserRole(userId: number, role: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!isGlobalRole(role)) return fail("Unknown role.");

  const target = await getUser(userId);
  if (!target) return fail("No such account.");

  if (target.globalRole === "admin" && role !== "admin") {
    if (await isLastAdmin(target.id)) {
      return fail("This is the only administrator. Promote someone else first.");
    }
    if (target.id === admin.id) {
      // Permitted, but worth being explicit that it is a one-way door for them.
      await destroyAllSessions(target.id);
    }
  }

  await db.update(users).set({ globalRole: role }).where(eq(users.id, userId));
  revalidatePath("/admin/users");
  return ok;
}

export async function setUserStatus(userId: number, status: "active" | "disabled"): Promise<ActionResult> {
  const admin = await requireAdmin();

  const target = await getUser(userId);
  if (!target) return fail("No such account.");
  if (target.status === "invited") return fail("This invitation has not been accepted yet.");

  if (status === "disabled") {
    if (target.id === admin.id) return fail("You cannot disable your own account.");
    if (target.globalRole === "admin" && (await isLastAdmin(target.id))) {
      return fail("This is the only administrator.");
    }
    // Disabling must take effect now, not at the end of their session.
    await destroyAllSessions(target.id);
  }

  await db.update(users).set({ status }).where(eq(users.id, userId));
  revalidatePath("/admin/users");
  return ok;
}

/** Force a user to sign in again everywhere, without disabling the account. */
export async function forceSignOut(userId: number): Promise<ActionResult> {
  await requireAdmin();
  await destroyAllSessions(userId);
  revalidatePath("/admin/users");
  return ok;
}

// ─── Reading ────────────────────────────────────────────────────────────

export interface AccountRow {
  id: number;
  name: string;
  email: string;
  globalRole: GlobalRole;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  pendingInvite: boolean;
  inviteExpired: boolean;
}

export async function listAccounts(): Promise<AccountRow[]> {
  await requireAdmin();

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      globalRole: users.globalRole,
      status: users.status,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
      inviteExpiresAt: invites.expiresAt,
      inviteAcceptedAt: invites.acceptedAt,
    })
    .from(users)
    .leftJoin(invites, and(eq(invites.userId, users.id), isNull(invites.acceptedAt)))
    .orderBy(desc(users.createdAt));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    globalRole: isGlobalRole(r.globalRole) ? r.globalRole : "assistant",
    status: r.status,
    createdAt: r.createdAt,
    lastLoginAt: r.lastLoginAt,
    pendingInvite: r.status === "invited" && !!r.inviteExpiresAt && !r.inviteAcceptedAt,
    inviteExpired: r.status === "invited" && (!r.inviteExpiresAt || isExpired(r.inviteExpiresAt)),
  }));
}

/** The signed-in user, for the sidebar. Null rather than a redirect. */
export async function currentAccount() {
  const user = await getCurrentUser();
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, globalRole: user.globalRole };
}

// ─── helpers ────────────────────────────────────────────────────────────

async function getUser(id: number) {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

async function isLastAdmin(userId: number): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(users)
    .where(and(eq(users.globalRole, "admin"), eq(users.status, "active")));
  const total = row?.n ?? 0;
  const target = await getUser(userId);
  return total <= 1 && target?.status === "active";
}

function isEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export { countActiveAdmins };
