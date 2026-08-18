import { describe, expect, it } from "vitest";

import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

import { signIn } from "@/actions/auth";
import { hashPassword } from "@/lib/auth/password";
import { MAX_FAILED_LOGIN_ATTEMPTS } from "@/lib/auth/lockout";
import { setTestIp } from "../../vitest.setup";

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
