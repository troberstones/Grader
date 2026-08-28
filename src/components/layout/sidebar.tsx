"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut, ScrollText, Settings, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { isGradingRoute } from "@/lib/grading-routes";
import { isPublicRoute } from "@/lib/auth-routes";
import { signOut } from "@/actions/auth";
import { navItemsFor } from "./nav-items";
import { useSessionMode } from "@/components/shared/session-mode";
import { ReviewBadge } from "@/components/shared/review-badge";

export interface SidebarAccount {
  id: number;
  name: string;
  email: string;
  globalRole: string;
}

export function Sidebar({ account }: { account: SidebarAccount | null }) {
  const pathname = usePathname();
  const mode = useSessionMode();
  const navItems = navItemsFor(mode);
  // Account management is `user.manage`, which no review session holds — so the
  // console would refuse every action it offered.
  const showAdmin = account?.globalRole === "admin" && mode !== "review";

  // Hide the permanent sidebar on grading/review pages — those use the
  // GradingShell layout with a hamburger drawer instead.
  if (isGradingRoute(pathname)) return null;

  // Sign-in, first-run setup and invitation acceptance have nowhere to
  // navigate to, so they get the whole window.
  if (isPublicRoute(pathname)) return null;

  return (
    // No border-r — tonal separation via bg-sidebar (#0a0a0a) against bg (#0e0e0e)
    <aside className="w-56 shrink-0 bg-sidebar flex flex-col">
      {/* Wordmark — no border-b, spacing creates the break */}
      <div className="px-5 pt-6 pb-5">
        <span className="text-base font-bold tracking-widest uppercase text-primary">
          Art Grader
        </span>
        <ReviewBadge className="mt-3 w-fit" />
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

        {showAdmin && (
          <Link
            href="/admin/users"
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-150",
              pathname.startsWith("/admin/users")
                ? "text-primary bg-primary/10"
                : "text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
          >
            <Users className={cn("h-4 w-4 shrink-0", pathname.startsWith("/admin/users") ? "text-primary" : "")} />
            Accounts
          </Link>
        )}

        {showAdmin && (
          <Link
            href="/admin/audit"
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-150",
              pathname.startsWith("/admin/audit")
                ? "text-primary bg-primary/10"
                : "text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
          >
            <ScrollText className={cn("h-4 w-4 shrink-0", pathname.startsWith("/admin/audit") ? "text-primary" : "")} />
            Audit log
          </Link>
        )}
      </nav>

      {account && <AccountFooter account={account} />}
    </aside>
  );
}

function AccountFooter({ account }: { account: SidebarAccount }) {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isActive = pathname.startsWith("/account");

  return (
    <div className="px-3 pb-4 pt-2">
      <Link
        href="/account"
        className={cn(
          "flex items-center justify-between gap-2 px-3 py-2 rounded-md transition-all duration-150",
          isActive ? "bg-primary/10" : "hover:bg-accent",
        )}
      >
        <div className="min-w-0">
          <div className={cn("text-sm font-medium truncate", isActive ? "text-primary" : "")}>{account.name}</div>
          <div className="text-xs text-muted-foreground truncate">{account.email}</div>
        </div>
        <Settings className={cn("h-3.5 w-3.5 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
      </Link>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await signOut();
            router.replace("/login");
            router.refresh();
          })
        }
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-150 disabled:opacity-50"
      >
        <LogOut className="h-4 w-4 shrink-0" />
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
