/**
 * Single source of truth for which pathnames use the grading shell
 * (hamburger nav + student sidebar). Both the root Sidebar and the
 * GradingShell import from here so adding a new grading page only
 * requires updating this one list.
 */
export const GRADING_ROUTE_PATTERNS = [
  /^\/assignments\/\d+$/,
  /^\/assignments\/\d+\/review$/,
] as const;

export function isGradingRoute(pathname: string): boolean {
  return GRADING_ROUTE_PATTERNS.some((p) => p.test(pathname));
}
