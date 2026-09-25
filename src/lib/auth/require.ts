/**
 * The authorization gate for server actions.
 *
 * Every exported function in a "use server" file is independently reachable —
 * Next assigns each one an RPC id and a client can call it directly, whether
 * or not any page actually renders a button that does. So the check belongs
 * inside each function, not at the page that happens to call it today.
 *
 * Failures throw rather than redirect, matching how the rest of the app
 * already handles action errors: callers wrap actions in try/catch and show
 * `err.message` via toast. Course/assignment/submission/student resources
 * are resolved against `course_members` via resolveAuthContext() before
 * `can()` runs — see src/lib/auth/course-context.ts and roles.ts.
 *
 * The thrown error is an `AuthError` — a distinguishable subclass, not a
 * bare `Error` — for the small number of callers (src/actions/grades.ts)
 * that need to tell "no session / no permission" apart from every other
 * failure and turn it into a typed `{ success:false, reason:"auth" }`
 * instead of letting it propagate. Every other caller still just lets it
 * throw and reads `err.message`, unchanged.
 */

import { can, GLOBAL, type Capability, type Resource } from "./roles";
import { resolveAuthContext } from "./course-context";
import { getCurrentUser, type SessionUser } from "./session";

/** Thrown by `requireCapability` when the session is missing/expired or the
 * user lacks the capability. See the module doc for why this is its own
 * class rather than a plain `Error`. */
export class AuthError extends Error {}

export async function requireCapability(
  capability: Capability,
  resource: Resource = GLOBAL,
): Promise<SessionUser> {
  const user = await getCurrentUser();
  const ctx = user ? await resolveAuthContext(resource, user.id) : {};
  if (!user || !can(user, capability, resource, ctx)) {
    throw new AuthError(user ? "You do not have permission to do that." : "Sign in required.");
  }
  return user;
}
