import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { isPublicRoute } from "@/lib/auth-routes";

/**
 * The coarse authentication gate.
 *
 * In Next.js 16 this file is `proxy.ts` — the `middleware` convention is
 * deprecated and renamed. The runtime is Node and cannot be configured to edge.
 *
 * This checks only that a session cookie is *present*, never that it is valid.
 * That is deliberate on two counts: the proxy is documented as something that
 * should not rely on shared modules or database access, and a redirect is a
 * convenience rather than a security boundary. The real check is
 * `requireUser()` in the page, which reads the session row and can therefore
 * tell a forged cookie from a real one.
 *
 * **API routes are not gated here.** They stay open until the authorization
 * sweep gives each one a real check — gating them with a cookie test would
 * break the Learning Suite bridge and the iPad sync bus while providing no
 * actual protection. See docs/accounts-and-courses.md, phase 3, and the "Known
 * gaps" list in docs/security.md.
 */
/**
 * Header carrying the request path into the render.
 *
 * A server layout has no access to the pathname, and the root layout needs it
 * to know whether an unauthenticated render is a sign-in page or a leak. This
 * is the documented way to pass information from the proxy to the application.
 */
export const PATHNAME_HEADER = "x-grader-pathname";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const forward = () => {
    const headers = new Headers(request.headers);
    headers.set(PATHNAME_HEADER, pathname);
    return NextResponse.next({ request: { headers } });
  };

  if (isPublicRoute(pathname)) return forward();

  if (request.cookies.has("grader_session")) return forward();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (pathname !== "/") url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except API routes, Next's own assets, and files with extensions.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
