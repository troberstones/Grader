import { beforeEach, vi } from "vitest";

import { db } from "@/db";
import { auditLog, feedbackLinks, feedbackSends, invites, sessions, uploadLinks, users } from "@/db/schema";
import { SESSION_COOKIE } from "@/lib/auth/session";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

// revalidatePath() requires a real Next.js request's static-generation store,
// which doesn't exist outside an actual server request — every action under
// test calls it as a side effect, so it's a no-op here rather than an error.
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

const cookieJar = new Map<string, string>();
let testIp = "203.0.113.5";

/** Lets a test simulate a distinct caller IP, e.g. for the lockout throttle. */
export function setTestIp(ip: string) {
  testIp = ip;
}

/**
 * Lets a test simulate more than one browser sharing one account.
 *
 * The mocked cookie jar below has a single slot, same as a real jar has a
 * single value per name — `createSession()` overwrites it every time it's
 * called. Capture the token it just set with `getSessionCookie()` before
 * calling it again, then hand that captured value back with
 * `setSessionCookie()` to act as that earlier session once more (e.g. to show
 * it was revoked).
 */
export function getSessionCookie(): string | undefined {
  return cookieJar.get(SESSION_COOKIE);
}

export function setSessionCookie(value: string | undefined): void {
  if (value === undefined) cookieJar.delete(SESSION_COOKIE);
  else cookieJar.set(SESSION_COOKIE, value);
}

// Backed by a shared Map so createSession() (writes the cookie) and
// getCurrentUser() (reads it back) round-trip within one test, without a
// real HTTP request.
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  }),
  headers: async () =>
    new Map([
      ["user-agent", "vitest"],
      ["x-forwarded-for", testIp],
    ]),
}));

// A real `sendmail` binary isn't guaranteed present in dev or CI.
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: vi.fn().mockResolvedValue({}) }) },
}));

beforeEach(async () => {
  cookieJar.clear();
  testIp = "203.0.113.5";
  await db.delete(auditLog);
  await db.delete(sessions);
  await db.delete(invites);
  // All three reference users (sent_by / created_by), so they go first.
  await db.delete(feedbackSends);
  await db.delete(feedbackLinks);
  await db.delete(uploadLinks);
  await db.delete(users);
});
