/**
 * The authorization gate for route handlers.
 *
 * Route handlers can't just throw the way server actions do — an uncaught
 * throw becomes Next's generic 500 page, not a clean 401/403 for a fetch()
 * caller. This returns a discriminated union so the call site can early-return
 * the prepared response:
 *
 *   const auth = await apiRequireCapability("course.view");
 *   if (!auth.user) return auth.response;
 *
 * Only for same-origin routes fetched from grader's own signed-in browser tab.
 * The LS-bridge and sync routes are cross-origin or credential-less by
 * construction and are deliberately left out of this — see docs/security.md.
 */

import { NextResponse } from "next/server";

import { can, GLOBAL, type Capability, type Resource } from "./roles";
import { getCurrentUser, type SessionUser } from "./session";

type ApiAuthResult = { user: SessionUser; response?: undefined } | { user: null; response: NextResponse };

export async function apiRequireCapability(
  capability: Capability,
  resource: Resource = GLOBAL,
): Promise<ApiAuthResult> {
  const user = await getCurrentUser();
  if (!user || !can(user, capability, resource)) {
    const status = user ? 403 : 401;
    const error = user ? "Forbidden" : "Sign in required";
    return { user: null, response: NextResponse.json({ error }, { status }) };
  }
  return { user };
}
