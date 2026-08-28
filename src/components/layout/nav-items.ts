import {
  Archive,
  BarChart3,
  BookOpen,
  ClipboardList,
  Grid3X3,
  Home,
} from "lucide-react";
import type { SessionMode } from "@/lib/auth/roles";

/**
 * The main navigation, and which sessions may see each destination.
 *
 * One list because there are two navigations — the permanent sidebar and the
 * grading shell's drawer — and they had drifted apart before. Same reasoning as
 * grading-routes.ts and auth-routes.ts: a destination that appears in one and
 * not the other is a bug nobody notices until they are looking for a link that
 * used to be there.
 *
 * `gradeOnly` is a presentation rule, not a security one. Each of these pages
 * runs `requireGradeSession()` itself, so hiding the link only avoids offering
 * a journey that ends in a redirect. Rubrics, Analytics and Archive all put a
 * rubric or somebody's marks on screen, which is precisely what a review
 * session is for not doing.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  gradeOnly?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/courses", label: "Courses", icon: BookOpen },
  { href: "/assignments", label: "Assignments", icon: ClipboardList },
  { href: "/rubrics", label: "Rubrics", icon: Grid3X3, gradeOnly: true },
  { href: "/analytics", label: "Analytics", icon: BarChart3, gradeOnly: true },
  { href: "/archive", label: "Archive", icon: Archive, gradeOnly: true },
];

export function navItemsFor(mode: SessionMode): readonly NavItem[] {
  return mode === "review" ? NAV_ITEMS.filter((item) => !item.gradeOnly) : NAV_ITEMS;
}
