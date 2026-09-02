"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { isGradingRoute } from "@/lib/grading-routes";
import Link from "next/link";
import { LogOut, Menu, Settings, Wifi, WifiOff } from "lucide-react";
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
import { navItemsFor } from "@/components/layout/nav-items";
import { useSessionMode } from "./session-mode";
import { ReviewBadge } from "./review-badge";
import type { StudentWithGrade } from "@/actions/grades";

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
      <StudentHotkeys />
      <StudentUrlSync />
      <ViewLayoutProvider>
        <div className="flex flex-col h-full">
          {/* Hamburger row */}
          <div className="shrink-0 px-3 py-2 flex items-center gap-2 border-b bg-sidebar">
            <NavDrawer />
            <SyncToggle />
            <ViewSwitch />
            <ReviewBadge className="ml-auto" />
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
  const { paused } = useGlobalSync();
  useSync(assignmentId, selectedStudentId, selectStudent, paused);
  return null;
}

/**
 * ↑/↓ move to the previous/next student — StudentNavBar's arrow buttons have
 * advertised this in their tooltips all along, but nothing ever registered the
 * listener (the only place it existed was the retired review-v1 page). Lives
 * here, next to SyncBridge, so it works from both the grade sheet and the
 * review page without either needing to know about the other.
 */
function StudentHotkeys() {
  const { students, selectedStudentId, selectStudent } = useGrading();

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;

      const idx = students.findIndex((s) => s.id === selectedStudentId);
      if (idx < 0) return;
      const target = e.key === "ArrowUp" ? students[idx - 1] : students[idx + 1];
      if (!target) return;
      e.preventDefault();
      selectStudent(target.id);
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [students, selectedStudentId, selectStudent]);

  return null;
}

/**
 * Keeps `?studentId=` pointing at whoever is actually selected.
 *
 * GradingProvider has always *read* that param for its opening selection, but
 * nothing ever wrote it, so a reload — the reflex when a video misbehaves —
 * silently dropped you back on the first student in the roster. Writing it on
 * every change makes reload and back/forward land where you were, and makes
 * the address bar a shareable pointer to one student's work.
 *
 * replaceState rather than router.replace: this records where you are, and a
 * Next navigation on every arrow-key step through a roster would refetch the
 * route each time. Next's own history state is passed through untouched.
 */
function StudentUrlSync() {
  const { selectedStudentId } = useGrading();

  useEffect(() => {
    if (selectedStudentId == null) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("studentId") === String(selectedStudentId)) return;
    url.searchParams.set("studentId", String(selectedStudentId));
    // A different student means a different playlist, so the item index that
    // belongs to the old one must not survive into the new URL.
    url.searchParams.delete("item");
    window.history.replaceState(window.history.state, "", url);
  }, [selectedStudentId]);

  return null;
}

function NavDrawer() {
  const pathname = usePathname();
  const router = useRouter();
  const navItems = navItemsFor(useSessionMode());
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
