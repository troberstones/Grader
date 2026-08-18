"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { isGradingRoute } from "@/lib/grading-routes";
import Link from "next/link";
import {
  Home,
  BookOpen,
  ClipboardList,
  Grid3X3,
  BarChart3,
  Archive,
  LogOut,
  Menu,
  Settings,
  Wifi,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { GradingProvider, useGrading } from "./grading-context";
import { StudentSidebar } from "./student-sidebar";
import { ViewLayoutProvider } from "./view-layout";
import { ViewSwitch } from "./view-switch";
import { useSync } from "@/hooks/use-sync";
import { useGlobalSync } from "./global-sync";
import { signOut } from "@/actions/auth";
import type { StudentWithGrade } from "@/actions/grades";

const navItems = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/courses", label: "Courses", icon: BookOpen },
  { href: "/assignments", label: "Assignments", icon: ClipboardList },
  { href: "/rubrics", label: "Rubrics", icon: Grid3X3 },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/archive", label: "Archive", icon: Archive },
];

interface GradingShellProps {
  students: StudentWithGrade[];
  assignmentId: number;
  children: React.ReactNode;
}

/**
 * Client wrapper for the grading/review layout.
 *
 * On grade & review pages:  hamburger menu + student sidebar + page content
 * On other child pages (e.g. edit):  just renders children (no sidebar).
 */
export function GradingShell({
  students,
  assignmentId,
  children,
}: GradingShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const studentIdParam = searchParams.get("studentId");
  const initialStudentId = studentIdParam ? Number(studentIdParam) : undefined;

  // Only show the grading chrome on the grade sheet and review pages.
  // The edit page (and any other sub-routes) get plain rendering.
  if (!isGradingRoute(pathname)) {
    return <>{children}</>;
  }

  return (
    <GradingProvider
      initialStudents={students}
      initialStudentId={initialStudentId}
    >
      <SyncBridge assignmentId={assignmentId} />
      <ViewLayoutProvider>
        <div className="flex flex-col h-full">
          {/* Hamburger row */}
          <div className="shrink-0 px-3 py-2 flex items-center gap-2 border-b bg-sidebar">
            <NavDrawer />
            <SyncToggle />
            <ViewSwitch />
          </div>

          {/* Main area: sidebar + page content */}
          <div className="flex flex-1 min-h-0">
            <StudentSidebar />
            <div className="flex-1 min-w-0 overflow-hidden">{children}</div>
          </div>
        </div>
      </ViewLayoutProvider>
    </GradingProvider>
  );
}

/** Rendered inside GradingProvider so it can access context. */
function SyncBridge({ assignmentId }: { assignmentId: number }) {
  const { selectedStudentId, selectStudent } = useGrading();
  useSync(assignmentId, selectedStudentId, selectStudent);
  return null;
}

function NavDrawer() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const accountActive = pathname.startsWith("/account");

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon-sm" title="Navigation menu" />
        }
      >
        <Menu className="h-4 w-4" />
      </SheetTrigger>
      <SheetContent side="left" className="w-56 p-0">
        <SheetTitle className="px-5 pt-6 pb-5">
          <span className="text-base font-bold tracking-widest uppercase text-primary">
            Art Grader
          </span>
        </SheetTitle>
        <SheetDescription className="sr-only">Main navigation</SheetDescription>
        <nav className="flex-1 px-3 pb-4 space-y-0.5">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-150",
                  isActive
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent",
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0 transition-colors",
                    isActive ? "text-primary" : "",
                  )}
                />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* This drawer replaces the permanent sidebar on grading/review
            routes (see isGradingRoute), so it's the only chrome on screen —
            without this, there was nowhere to reach Account or Sign out
            from a grading page. */}
        <SheetFooter className="gap-0.5 p-3 pt-2">
          <Link
            href="/account"
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-150",
              accountActive
                ? "text-primary bg-primary/10"
                : "text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
          >
            <Settings className={cn("h-4 w-4 shrink-0", accountActive ? "text-primary" : "")} />
            Account
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
            className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-150 disabled:opacity-50"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {pending ? "Signing out…" : "Sign out"}
          </button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function SyncToggle() {
  const { paused, setPaused } = useGlobalSync();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title={paused ? "Sync paused — click to resume" : "Sync active — click to pause"}
      onClick={() => setPaused((p) => !p)}
    >
      {paused ? (
        <WifiOff className="h-4 w-4 text-muted-foreground" />
      ) : (
        <Wifi className="h-4 w-4 text-primary" />
      )}
    </Button>
  );
}
