/**
 * Routes reachable without a session.
 *
 * Kept beside grading-routes.ts and used by three places that must agree: the
 * proxy gate, the sidebar (which hides itself on these), and the pages
 * themselves. Divergence between them shows up as either a redirect loop or an
 * unprotected page, so there is one list.
 */
export const PUBLIC_ROUTES = ["/login", "/setup", "/invite"] as const;

export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

/**
 * Sanitise a `?next=` destination.
 *
 * Only same-origin absolute paths are returned. Without this the login form is
 * an open redirect: `/login?next=https://elsewhere.example` would send someone
 * off-site immediately after authenticating, which is a convincing place to ask
 * them for their password a second time.
 */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (isPublicRoute(next)) return fallback;
  return next;
}
