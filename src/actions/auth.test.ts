import { describe, expect, it } from "vitest";

import { db } from "@/db";
import { auditLog, users } from "@/db/schema";
import { eq } from "drizzle-orm";

import { changeOwnPassword, signIn } from "@/actions/auth";
import { hashPassword } from "@/lib/auth/password";
import { MAX_FAILED_LOGIN_ATTEMPTS } from "@/lib/auth/lockout";
import { createSession, getCurrentUser } from "@/lib/auth/session";
import { getSessionCookie, setSessionCookie, setTestIp } from "../../vitest.setup";

async function seedUser(email = "instructor@example.test", password = "correct horse battery") {
  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(users)
    .values({ name: "Test User", email, passwordHash, globalRole: "instructor", status: "active" })
    .returning();
  return { ...user, password };
}

function loginForm(email: string, password: string): FormData {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("password", password);
  return fd;
}

describe("signIn lockout", () => {
  it("locks the account after repeated failures and blocks even a correct password", async () => {
    const user = await seedUser();

    for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS; i++) {
      // Distinct IP per attempt so the IP throttle (a much higher threshold)
      // never trips first — this test isolates the account-lockout layer.
      setTestIp(`203.0.113.${100 + i}`);
      const result = await signIn(null, loginForm(user.email, "wrong password"));
      expect(result.ok).toBe(false);
    }

    setTestIp("203.0.113.199");
    const result = await signIn(null, loginForm(user.email, user.password));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/temporarily locked/i);
  });

  it("unlocks once lockedUntil has passed, and resets the counters on success", async () => {
    const user = await seedUser();

    for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS; i++) {
      setTestIp(`203.0.113.${120 + i}`);
      await signIn(null, loginForm(user.email, "wrong password"));
    }

    await db.update(users).set({ lockedUntil: "2000-01-01 00:00:00" }).where(eq(users.id, user.id));

    setTestIp("203.0.113.150");
    const result = await signIn(null, loginForm(user.email, user.password));
    expect(result.ok).toBe(true);

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row.failedLoginAttempts).toBe(0);
    expect(row.lockedUntil).toBeNull();
  });
});

describe("signIn IP throttle", () => {
  it("throttles repeated failures from one IP regardless of which account is targeted", async () => {
    await seedUser("a@example.test");
    setTestIp("198.51.100.42");

    // A different (nonexistent) email each time so account-level lockout
    // never triggers — this test isolates the IP layer.
    for (let i = 0; i < 20; i++) {
      await signIn(null, loginForm(`nobody-${i}@example.test`, "wrong password"));
    }

    const result = await signIn(null, loginForm("a@example.test", "wrong password"));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too many attempts/i);
  });
});

describe("signIn audit", () => {
  it("writes an audit row naming the attempted email on a failed login, never the password", async () => {
    const user = await seedUser();

    const result = await signIn(null, loginForm(user.email, "wrong password"));
    expect(result.ok).toBe(false);

    const rows = await db.select().from(auditLog).where(eq(auditLog.action, "auth.sign_in_failed"));
    expect(rows).toHaveLength(1);
    expect(rows[0].actorEmail).toBe(user.email);
    expect(rows[0].actorId).toBe(user.id);
    expect(rows[0].detail).not.toMatch(/wrong password/);
  });

  it("writes an audit row for an attempt against an email with no account", async () => {
    // Seed an unrelated account first — with no accounts at all, signIn()
    // short-circuits into "set up the first administrator" before it ever
    // gets to a lookup, which isn't the path this test means to exercise.
    await seedUser("someone-else@example.test");

    await signIn(null, loginForm("nobody@example.test", "whatever"));

    const rows = await db.select().from(auditLog).where(eq(auditLog.action, "auth.sign_in_failed"));
    expect(rows).toHaveLength(1);
    expect(rows[0].actorId).toBeNull();
    expect(rows[0].actorEmail).toBe("nobody@example.test");
  });

  it("writes an audit row on a successful sign-in", async () => {
    const user = await seedUser();

    const result = await signIn(null, loginForm(user.email, user.password));
    expect(result.ok).toBe(true);

    const rows = await db.select().from(auditLog).where(eq(auditLog.action, "auth.sign_in"));
    expect(rows).toHaveLength(1);
    expect(rows[0].actorEmail).toBe(user.email);
  });
});

describe("changeOwnPassword session revocation", () => {
  function passwordForm(currentPassword: string, newPassword: string): FormData {
    const fd = new FormData();
    fd.set("currentPassword", currentPassword);
    fd.set("newPassword", newPassword);
    fd.set("confirm", newPassword);
    return fd;
  }

  it("keeps the session that made the change but destroys every other one for that user", async () => {
    const user = await seedUser();

    // A session in another browser, left signed in.
    await createSession(user.id, {});
    const otherSessionToken = getSessionCookie();

    // The session actually making the change.
    await createSession(user.id, {});
    const currentSessionToken = getSessionCookie();

    const result = await changeOwnPassword(null, passwordForm(user.password, "a whole new passphrase"));
    expect(result.ok).toBe(true);

    setSessionCookie(currentSessionToken);
    expect(await getCurrentUser()).not.toBeNull();

    setSessionCookie(otherSessionToken);
    expect(await getCurrentUser()).toBeNull();
  });

  it("writes audit rows for the password change and the sessions it revoked", async () => {
    const user = await seedUser();
    await createSession(user.id, {}); // the other session that gets revoked
    await createSession(user.id, {}); // the one making the change

    await changeOwnPassword(null, passwordForm(user.password, "a whole new passphrase"));

    const changeRows = await db.select().from(auditLog).where(eq(auditLog.action, "user.password_change"));
    expect(changeRows).toHaveLength(1);
    expect(changeRows[0].actorId).toBe(user.id);

    const revokeRows = await db.select().from(auditLog).where(eq(auditLog.action, "session.revoke"));
    expect(revokeRows).toHaveLength(1);
  });
});
