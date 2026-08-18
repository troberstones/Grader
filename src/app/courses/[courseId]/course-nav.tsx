"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CourseRole } from "@/lib/auth/roles";

export function CourseNav({
  courseId,
  courseName,
  courseCode,
  viewerRole,
}: {
  courseId: number;
  courseName: string;
  courseCode: string;
  viewerRole: CourseRole | null;
}) {
  const pathname = usePathname();

  const items = [
    { href: `/courses/${courseId}`, label: "Overview", icon: LayoutDashboard, exact: true },
    { href: `/courses/${courseId}/roster`, label: "Roster", icon: Users, exact: false },
    // course.members.manage is owner-only — no dead link for anyone else.
    ...(viewerRole === "owner"
      ? [{ href: `/courses/${courseId}/members`, label: "Members", icon: ShieldCheck, exact: false }]
      : []),
  ];

  return (
    <nav className="w-48 shrink-0 border-r px-3 py-6 space-y-1">
      <div className="px-2 mb-4">
        <div className="text-sm font-medium truncate">{courseName}</div>
        <div className="text-xs text-muted-foreground">{courseCode}</div>
      </div>
      {items.map(({ href, label, icon: Icon, exact }) => {
        const isActive = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
              isActive
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
