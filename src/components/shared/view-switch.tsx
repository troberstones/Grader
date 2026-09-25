"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ClipboardList, Image as ImageIcon, PanelRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useGrading } from "./grading-context";
import { useIsReviewing } from "./session-mode";
import { useViewLayout } from "./view-layout";
import { isReviewRoute } from "@/lib/grading-routes";
import { cn } from "@/lib/utils";

/**
 * Rubric ↔ Artwork, and the dock toggle that puts them side by side.
 *
 * This is deliberately part of the shell rather than of either page. Both
 * destinations render it identically, so the trip can't go one-way — which is
 * exactly what happened when each page passed its own link into StudentNavBar:
 * the art reviewer never passed one, so the moment it became the default viewer
 * the only way back to the rubric was the hamburger menu.
 *
 * It also costs no vertical space. The shell's header row already exists on
 * every grading route and was mostly empty; a third bar would have come out of
 * the viewer's height, which is the scarce dimension on a tablet.
 */
export function ViewSwitch() {
  const pathname = usePathname();
  const router = useRouter();
  const { selectedStudentId, flushHandlerRef } = useGrading();
  const { canDock, rubricDocked, setRubricDocked } = useViewLayout();
  const reviewing = useIsReviewing();
  const [switching, setSwitching] = useState(false);

  const assignmentId = pathname.match(/^\/assignments\/(\d+)(\/|$)/)?.[1];
  const onArtwork = isReviewRoute(pathname);

  const href = (mode: "rubric" | "artwork") => {
    const student = selectedStudentId ? `?studentId=${selectedStudentId}` : "";
    return mode === "rubric"
      ? `/assignments/${assignmentId}${student}`
      : `/assignments/${assignmentId}/review${student}`;
  };

  // Flushes the rubric's pending autosave before leaving it — bypassing this
  // (a direct router.push) is how an edit made seconds ago on the grade sheet
  // never made it into the save that was still sitting on its 1.5s debounce.
  // A failed flush keeps the view where it is instead of carrying the grader
  // off to artwork with unsaved work behind them.
  async function go(mode: "rubric" | "artwork") {
    setSwitching(true);
    const ok = await flushHandlerRef.current();
    setSwitching(false);
    if (!ok) {
      toast.error("Couldn't save your changes — try again before switching views");
      return;
    }
    router.push(href(mode));
  }

  // "t" flips between the two. It used to live in the grade sheet and only
  // pushed one way, which meant the key did nothing once you were on the
  // artwork — the same half-wiring as the button.
  useEffect(() => {
    if (!assignmentId || reviewing) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "t" || e.metaKey || e.ctrlKey || e.altKey) return;
      // The art reviewer's own "t" is its Text tool (ArtReviewer.tsx) — this
      // shortcut only ever flips rubric → artwork, never the other way.
      if (onArtwork) return;
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      e.preventDefault();
      void go("artwork");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId, onArtwork, selectedStudentId, reviewing, flushHandlerRef]);

  if (!assignmentId) return null;

  // A review session has one destination, so a switch with one reachable side
  // would be a control that does nothing. The rubric is not merely disabled
  // here — there is no affordance for it at all, which is the point when the
  // screen is facing a room.
  if (reviewing) return null;

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center rounded-md border p-0.5" role="group">
        <SegmentButton
          active={!onArtwork}
          disabled={switching}
          onClick={() => void go("rubric")}
          title="Rubric — score this student (t)"
        >
          <ClipboardList className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Rubric</span>
        </SegmentButton>
        <SegmentButton
          active={onArtwork}
          disabled={switching}
          onClick={() => void go("artwork")}
          title="Artwork — review the submission (t)"
        >
          <ImageIcon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Artwork</span>
        </SegmentButton>
      </div>

      {/*
       * Docking is offered only where it fits. Below 1024px the rubric would
       * squeeze the artwork into a strip, so the segmented switch above is the
       * whole story and this button isn't rendered at all.
       */}
      {onArtwork && canDock && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setRubricDocked(!rubricDocked)}
          title={rubricDocked ? "Undock the rubric" : "Dock the rubric beside the artwork"}
          aria-pressed={rubricDocked}
        >
          <PanelRight className={cn("h-4 w-4", rubricDocked && "text-primary")} />
        </Button>
      )}
    </div>
  );
}

function SegmentButton({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}
