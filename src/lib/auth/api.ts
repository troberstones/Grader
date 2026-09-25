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
 * For a state-changing request (anything but GET/HEAD), pass the incoming
 * `request` as the third argument so this can also reject a cross-site
 * request before it reaches the capability check — see
 * `isCrossOriginRequest` below. Every route under /api/ls-bridge and
 * /api/submissions/upload now requires a normal session too (closing the gap
 * described in docs/security.md #1); the one exception is the LS Bridge
 * extension's own background service worker, which posts cross-origin by
 * construction and is allow-listed via ALLOWED_EXTENSION_ORIGINS.
 */

import { NextResponse } from "next/server";

import { can, GLOBAL, type Capability, type Resource } from "./roles";
import { resolveAuthContext } from "./course-context";
import { getCurrentUser, type SessionUser } from "./session";

type ApiAuthResult = { user: SessionUser; response?: undefined } | { user: null; response: NextResponse };

const SAFE_METHODS = new Set(["GET", "HEAD"]);

/**
 * Origins allowed to make a cross-site, credentialed, state-changing request
 * — today just the LS Bridge extension's background service worker, whose
 * fetches carry `Origin: chrome-extension://<id>` rather than this app's own
 * origin (unlike its content scripts, which fetch from the grader page and
 * are same-origin already). Comma-separated; see .env.example.
 */
function allowedExtensionOrigins(): string[] {
  return (process.env.ALLOWED_EXTENSION_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * True for a state-changing request whose `Origin` header disagrees with its
 * own `Host` — the shape of a cross-site request a browser would send from
 * another page (or a plain HTML form post, which `sameSite=lax` alone does
 * not stop). GET/HEAD are exempt since they should never have side effects.
 * A request with no `Origin` header at all (same-origin navigations, most
 * non-browser HTTP clients) is not flagged — this is a defense against
 * cross-site *browser* requests, not a general allow-list of callers.
 */
function isCrossOriginRequest(request: Request): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return false;

  const origin = request.headers.get("origin");
  if (!origin) return false;
  if (allowedExtensionOrigins().includes(origin)) return false;

  const host = request.headers.get("host");
  if (!host) return false;

  try {
    return new URL(origin).host !== host;
  } catch {
    // Not a parseable Origin value — not a legitimate browser-set header.
    return true;
  }
}

export async function apiRequireCapability(
  capability: Capability,
  resource: Resource = GLOBAL,
  request?: Request,
): Promise<ApiAuthResult> {
  if (request && isCrossOriginRequest(request)) {
    return { user: null, response: NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 }) };
  }

  const user = await getCurrentUser();
  const ctx = user ? await resolveAuthContext(resource, user.id) : {};
  if (!user || !can(user, capability, resource, ctx)) {
    const status = user ? 403 : 401;
    const error = user ? "Forbidden" : "Sign in required";
    return { user: null, response: NextResponse.json({ error }, { status }) };
  }
  return { user };
}
