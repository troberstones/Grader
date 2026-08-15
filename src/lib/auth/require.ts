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
 * `err.message` via toast. COURSE_SCOPING_PENDING means every check below is
 * still against the global resource — see src/lib/auth/roles.ts.
 */

import { can, GLOBAL, type Capability, type Resource } from "./roles";
import { getCurrentUser, type SessionUser } from "./session";

export async function requireCapability(
  capability: Capability,
  resource: Resource = GLOBAL,
): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user || !can(user, capability, resource)) {
    throw new Error(user ? "You do not have permission to do that." : "Sign in required.");
  }
  return user;
}
