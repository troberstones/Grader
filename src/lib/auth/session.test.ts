import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { createSession, getCurrentUser, requireAdmin, requireGradeSession } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";

async function seedActiveUser(email = "session@example.test") {
  const passwordHash = await hashPassword("correct horse battery staple");
  const [user] = await db
    .insert(users)
    .values({ name: "Session Test", email, passwordHash, globalRole: "instructor", status: "active" })
    .returning();
  return user;
}

describe("session round-trip", () => {
  it("returns the signed-in user after createSession()", async () => {
    const user = await seedActiveUser();
    await createSession(user.id, { userAgent: "vitest", ip: "203.0.113.5" });

    const current = await getCurrentUser();
    expect(current?.id).toBe(user.id);
    expect(current?.email).toBe(user.email);
  });

  it("returns null and deletes the row once the session has expired", async () => {
    const user = await seedActiveUser();
    await createSession(user.id, {});

    const [session] = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    await db.update(sessions).set({ expiresAt: "2000-01-01 00:00:00" }).where(eq(sessions.id, session.id));

    const current = await getCurrentUser();
    expect(current).toBeNull();

    const remaining = await db.select().from(sessions).where(eq(sessions.id, session.id));
    expect(remaining).toHaveLength(0);
  });

  it("slides expiresAt forward once inside the refresh window", async () => {
    const user = await seedActiveUser();
    await createSession(user.id, {});

    const [session] = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    // Inside the refresh window: less than 24h remaining out of the 30-day TTL.
    const soon = new Date(Date.now() + 60 * 60 * 1000);
    const soonStr = soon.toISOString().replace("T", " ").slice(0, 19);
    await db.update(sessions).set({ expiresAt: soonStr }).where(eq(sessions.id, session.id));

    await getCurrentUser();

    const [refreshed] = await db.select().from(sessions).where(eq(sessions.id, session.id));
    const refreshedMs = Date.parse(refreshed.expiresAt.replace(" ", "T") + "Z");
    expect(refreshedMs).toBeGreaterThan(soon.getTime() + 60 * 60 * 1000);
  });

  it("drops all sessions immediately once the account is disabled", async () => {
    const user = await seedActiveUser();
    await createSession(user.id, {});

    await db.update(users).set({ status: "disabled" }).where(eq(users.id, user.id));

    const current = await getCurrentUser();
    expect(current).toBeNull();

    const remaining = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(remaining).toHaveLength(0);
  });
});


describe("session mode", () => {
  it("defaults to a grading session", async () => {
    const user = await seedActiveUser("mode-default@example.test");
    await createSession(user.id, {});
    expect((await getCurrentUser())?.mode).toBe("grade");
  });

  it("round-trips the mode chosen at sign-in", async () => {
    const user = await seedActiveUser("mode-review@example.test");
    await createSession(user.id, {}, "review");
    expect((await getCurrentUser())?.mode).toBe("review");
  });

  it("treats an unrecognised stored mode as the restricted one", async () => {
    // A row from a future version, or one edited by hand. The safe direction
    // for an unreadable value is fewer permissions, never more.
    const user = await seedActiveUser("mode-bogus@example.test");
    await createSession(user.id, {}, "grade");
    await db
      .update(sessions)
      .set({ mode: "administrator" as unknown as "grade" })
      .where(eq(sessions.userId, user.id));

    expect((await getCurrentUser())?.mode).toBe("review");
  });
});


describe("page guards against a review session", () => {
  /** The setup file mocks redirect() to throw `NEXT_REDIRECT:<url>`. */
  async function redirectedTo(fn: () => Promise<unknown>): Promise<string | null> {
    try {
      await fn();
      return null;
    } catch (err) {
      const message = (err as Error).message;
      if (!message.startsWith("NEXT_REDIRECT:")) throw err;
      return message.slice("NEXT_REDIRECT:".length);
    }
  }

  it("lets a grading session through", async () => {
    const user = await seedActiveUser("guard-grade@example.test");
    await createSession(user.id, {}, "grade");
    expect(await redirectedTo(() => requireGradeSession("/assignments/1/review"))).toBeNull();
  });

  it("bounces a review session to the destination it was given", async () => {
    const user = await seedActiveUser("guard-review@example.test");
    await createSession(user.id, {}, "review");
    expect(await redirectedTo(() => requireGradeSession("/assignments/1/review")))
      .toBe("/assignments/1/review");
  });

  it("keeps a review session out of the admin console, admin or not", async () => {
    const passwordHash = await hashPassword("correct horse battery staple");
    const [user] = await db
      .insert(users)
      .values({
        name: "Admin", email: "guard-admin@example.test", passwordHash,
        globalRole: "admin", status: "active",
      })
      .returning();

    await createSession(user.id, {}, "grade");
    expect(await redirectedTo(() => requireAdmin())).toBeNull();

    await db.update(sessions).set({ mode: "review" }).where(eq(sessions.userId, user.id));
    expect(await redirectedTo(() => requireAdmin())).toBe("/");
  });
});
