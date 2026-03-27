"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  ClipboardList,
  Grid3X3,
  BarChart3,
  Archive,
  Home,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/courses", label: "Courses", icon: BookOpen },
  { href: "/assignments", label: "Assignments", icon: ClipboardList },
  { href: "/rubrics", label: "Rubrics", icon: Grid3X3 },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/archive", label: "Archive", icon: Archive },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    // No border-r — tonal separation via bg-sidebar (#0a0a0a) against bg (#0e0e0e)
    <aside className="w-56 shrink-0 bg-sidebar flex flex-col">
      {/* Wordmark — no border-b, spacing creates the break */}
      <div className="px-5 pt-6 pb-5">
        <span className="text-base font-bold tracking-widest uppercase text-primary">
          Art Grader
        </span>
      </div>

      <nav className="flex-1 px-3 pb-4 space-y-0.5">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-150",
                isActive
                  // Active: orange text + very subtle tinted bg — the accent "pop"
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0 transition-colors",
                  isActive ? "text-primary" : ""
                )}
              />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
