"use server";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { invites, users } from "@/db/schema";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { expiryFromNow, generateToken, hashToken, isExpired, INVITE_TTL_MS, sqlTimestamp } from "@/lib/auth/tokens";
import { isGlobalRole, isSessionMode, type GlobalRole, type SessionMode } from "@/lib/auth/roles";
import {
  isIpThrottled,
  isLockedOut,
  recordFailedLogin,
  recordIpFailure,
  resetFailedLogins,
} from "@/lib/auth/lockout";
import { writeAudit } from "@/lib/audit";
import { sendInviteEmail } from "@/lib/email";
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
  requireUser,
} from "@/lib/auth/session";

export interface ActionResult {
  ok: boolean;
  error?: string;
  /** Set when the caller should show the invitation link to copy. */
  inviteUrl?: string;
  /** Set by inviteUser()/resetPassword(): whether the best-effort email send succeeded. */
  emailSent?: boolean;
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
 * A locked-out account is treated the same way, for the same reason —
 * see src/lib/auth/lockout.ts.
 *
 * Two rate-limit layers run before any password work: an IP-wide throttle
 * (catches a script trying many emails from one place) and per-account
 * lockout (catches repeated guesses against one email, from anywhere). A
 * locked account skips `verifyPassword()` entirely — there is no reason to
 * pay the scrypt cost when the outcome is already fixed — but still counts
 * as an attempt against the IP throttle.
 *
 * Signature is `(prevState, formData)` so `useActionState` can bind it
 * directly to `<form action={...}>` — that gives the form a real fallback
 * (a plain HTTP POST) when client JS never runs, instead of the button doing
 * nothing at all. See login-form.tsx.
 */
export async function signIn(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  // Which button was pressed. Absent when something other than the sign-in form
  // calls this, and when the browser submits implicitly on Enter it sends the
  // first submit button in the form — which is why "Grade" is rendered first:
  // pressing Enter lands on the unrestricted session this app has always given.
  const rawMode = formData.get("mode");
  const mode: SessionMode = isSessionMode(rawMode) ? rawMode : "grade";

  if (await needsBootstrap()) return fail("No accounts exist yet. Set up the first administrator.");

  const meta = await requestMeta();
  if (isIpThrottled(meta.ip)) {
    return fail("Too many attempts from this network. Wait a few minutes and try again.");
  }

  const user = await findUserByEmail(email);

  if (user && isLockedOut(user)) {
    recordIpFailure(meta.ip);
    return fail("This account is temporarily locked after repeated failed attempts. Try again later.");
  }

  // Always run a verification, even with no user, so that a missing account and
  // a wrong password take a comparable amount of time.
  const valid = await verifyPassword(password ?? "", user?.passwordHash ?? null);

  if (!user || !valid) {
    recordIpFailure(meta.ip);
    if (user) await recordFailedLogin(user.id);
    return fail("That email and password do not match.");
  }

  if (user.status === "disabled") {
    return fail("This account has been disabled. Ask an administrator to re-enable it.");
  }
  if (user.status === "invited" || !user.passwordHash) {
    return fail("This account has not been set up yet. Use the invitation link you were sent.");
  }

  await resetFailedLogins(user.id);
  await createSession(user.id, meta, mode);
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
 *
 * `(prevState, formData)` signature, same reasoning as `signIn` — this is the
 * only entry point into a brand-new deployment, so it has to work even if
 * client JS never loads. The password-match check moved here from the client
 * component for the same reason: a client-only wrapper around this function
 * can't be handed to `<form action>`, only the real server action can.
 *
 * Redirects itself on success rather than returning `ok` for the client to
 * act on — a redirect here works whether or not client JS ever hydrated,
 * where a `useEffect`-driven one does not. See acceptInvite() for the
 * failure mode that motivated this.
 */
export async function bootstrapAdmin(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  if (!(await needsBootstrap())) return fail("An account already exists. Sign in instead.");

  const name = String(formData.get("name") ?? "").trim();
  const email = normaliseEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!name) return fail("Enter your name.");
  if (!isEmail(email)) return fail("Enter a valid email address.");
  if (password !== confirm) return fail("The two passwords do not match.");

  const problem = passwordProblem(password);
  if (problem) return fail(problem);

  const passwordHash = await hashPassword(password);

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
  redirect("/");
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

  const emailSent = await sendInviteEmail(email, name, `/invite/${token}`, false);
  await writeAudit(admin, { action: "user.invite", targetType: "user", targetId: userId, detail: { email, role } });
  revalidatePath("/admin/users");
  return { ok: true, inviteUrl: `/invite/${token}`, emailSent };
}

/**
 * Issue a single-use link that lets an active user set a new password.
 *
 * There is no self-service "forgot password" anywhere in this app — invite
 * and reset links are still handed off by an admin, who can always copy and
 * share the link directly. The link is emailed too, best-effort, via the
 * host's own local mail transport (see src/lib/email.ts) — that's additive,
 * never a replacement, since a send failure must not block issuing the
 * link. `inviteUser()` refuses to touch an already-active account, but
 * `acceptInvite()` doesn't care whether the account was active already — it
 * overwrites `passwordHash` and sets `status: "active"` unconditionally. So
 * the only genuinely new piece here is issuing a token for someone
 * `inviteUser()` would reject.
 */
export async function resetPassword(userId: number): Promise<ActionResult> {
  const admin = await requireAdmin();

  const target = await getUser(userId);
  if (!target) return fail("No such account.");
  if (target.status !== "active") return fail("Only an active account can be reset — enable it first.");

  // Same reasoning as inviteUser(): an unconsumed link left lying around
  // would let two different reset attempts both be valid at once.
  await db.delete(invites).where(and(eq(invites.userId, userId), isNull(invites.acceptedAt)));

  const token = generateToken();
  await db.insert(invites).values({
    userId,
    tokenHash: hashToken(token),
    invitedBy: admin.id,
    expiresAt: expiryFromNow(INVITE_TTL_MS),
  });

  const emailSent = await sendInviteEmail(target.email, target.name, `/invite/${token}`, true);
  await writeAudit(admin, { action: "user.password_reset_issued", targetType: "user", targetId: userId, detail: { email: target.email } });
  revalidatePath("/admin/users");
  return { ok: true, inviteUrl: `/invite/${token}`, emailSent };
}

export interface InviteDetails {
  name: string;
  email: string;
  globalRole: GlobalRole;
  /** True when this token was issued for an already-active account (resetPassword()), not a fresh invite. */
  isReset: boolean;
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

  // Only resetPassword() issues a token for an account that's already
  // active — inviteUser() refuses to. So the account's current status here
  // (before the form below sets it to "active" regardless) is enough to
  // tell the two cases apart, no separate flag needed on `invites`.
  return { name: row.name, email: row.email, globalRole: row.globalRole, isReset: row.status === "active" };
}

/**
 * Accept an invitation by setting a password.
 *
 * The invitation is consumed inside the same statement that checks it is
 * unconsumed, so two submissions of the same link cannot both create a session.
 *
 * `(token, prevState, formData)` — bound with `acceptInvite.bind(null, token)`
 * before being handed to `useActionState`, same reasoning as `bootstrapAdmin`:
 * this is an entry point that has to work without client JS.
 *
 * Redirects itself on success instead of returning `ok`. It used to return
 * `ok` and let a client `useEffect` navigate away — but if that page ever
 * re-renders before the client gets there (a slow/partial hydration, or the
 * no-JS fallback this form is built to support), `page.tsx` re-checks the
 * same token, finds it already consumed by the success that just happened,
 * and shows "this invitation is not valid" — even though the password was
 * changed and the session was created. Redirecting from here sidesteps that
 * re-render happening at all.
 */
export async function acceptInvite(
  token: string,
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const details = await inspectInvite(token);
  if (!details) return fail("This invitation is no longer valid. Ask for a new one.");

  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  if (password !== confirm) return fail("The two passwords do not match.");

  const problem = passwordProblem(password);
  if (problem) return fail(problem);

  const claimed = await db
    .update(invites)
    .set({ acceptedAt: sqlTimestamp(new Date()) })
    .where(and(eq(invites.tokenHash, hashToken(token)), isNull(invites.acceptedAt)))
    .returning({ userId: invites.userId });

  if (claimed.length === 0) return fail("This invitation has already been used.");

  const passwordHash = await hashPassword(password);

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
  redirect("/");
}

// ─── Self-service ───────────────────────────────────────────────────────
// The signed-in user acting on their own account — distinct from "Account
// administration" below, which is admin-on-someone-else and checks
// `requireAdmin()`. These check `requireUser()` and always operate on
// `getCurrentUser()`'s id, never a userId argument, so there is no id to
// mix up with someone else's account.

/**
 * `(prevState, formData)` — same `useActionState` reasoning as the other auth
 * forms, even though this one is never reached before sign-in: it keeps a
 * plain HTML POST as a working fallback instead of a client-only handler.
 */
export async function updateOwnProfile(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();

  const name = String(formData.get("name") ?? "").trim();
  const email = normaliseEmail(String(formData.get("email") ?? ""));

  if (!name) return fail("Enter your name.");
  if (!isEmail(email)) return fail("Enter a valid email address.");

  if (email !== user.email) {
    const existing = await findUserByEmail(email);
    if (existing && existing.id !== user.id) return fail(`${email} is already in use by another account.`);
  }

  await db.update(users).set({ name, email }).where(eq(users.id, user.id));
  // The sidebar's name/email come from the root layout, not this route.
  revalidatePath("/", "layout");
  return ok;
}

/** Requires the current password, unlike an admin's resetPassword() — this is the account owner proving it's still them. */
export async function changeOwnPassword(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const target = await getUser(user.id);
  if (!(await verifyPassword(currentPassword, target?.passwordHash ?? null))) {
    return fail("Your current password is incorrect.");
  }

  if (newPassword !== confirm) return fail("The two new passwords do not match.");

  const problem = passwordProblem(newPassword);
  if (problem) return fail(problem);

  const passwordHash = await hashPassword(newPassword);
  await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));
  revalidatePath("/account");
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
  await writeAudit(admin, {
    action: "user.role_change",
    targetType: "user",
    targetId: userId,
    detail: { from: target.globalRole, to: role },
  });
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
  await writeAudit(admin, {
    action: "user.status_change",
    targetType: "user",
    targetId: userId,
    detail: { from: target.status, to: status },
  });
  revalidatePath("/admin/users");
  return ok;
}

/** Force a user to sign in again everywhere, without disabling the account. */
export async function forceSignOut(userId: number): Promise<ActionResult> {
  const admin = await requireAdmin();
  await destroyAllSessions(userId);
  await writeAudit(admin, { action: "user.force_sign_out", targetType: "user", targetId: userId });
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
  canViewArchive: boolean;
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
      canViewArchive: users.canViewArchive,
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
    canViewArchive: r.canViewArchive === 1,
  }));
}

/** Admin-only, independent of course membership — see src/actions/archive.ts. */
export async function setCanViewArchive(userId: number, value: boolean): Promise<ActionResult> {
  await requireAdmin();
  await db.update(users).set({ canViewArchive: value ? 1 : 0 }).where(eq(users.id, userId));
  revalidatePath("/admin/users");
  return ok;
}

/** The signed-in user, for the sidebar. Null rather than a redirect. */
export async function currentAccount() {
  const user = await getCurrentUser();
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    globalRole: user.globalRole,
    mode: user.mode,
  };
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
