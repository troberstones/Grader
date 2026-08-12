"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RubricGradingPanel } from "@/components/rubric/rubric-grading-panel";
import { useRubricGrading } from "@/hooks/use-rubric-grading";
import { useGrading } from "@/components/shared/grading-context";
import type { getAssignment } from "@/actions/assignments";

type Assignment = NonNullable<Awaited<ReturnType<typeof getAssignment>>>;

/**
 * The rubric, docked to the right of the artwork.
 *
 * Mounted only when the window is wide enough and the instructor has asked for
 * it (see ViewLayoutProvider), so the grading state machine it owns exists at
 * most once — the grade sheet page owns the other instance, and the two are
 * never alive at the same time.
 */
export function RubricDock({ assignment }: { assignment: Assignment }) {
  const grading = useRubricGrading(assignment);
  const { students, selectedStudentId } = useGrading();
  const student = students.find((s) => s.id === selectedStudentId);

  return (
    <TooltipProvider>
      <aside
        className="w-[380px] xl:w-[440px] shrink-0 border-l bg-background flex flex-col min-h-0"
        style={{
          // The review route puts <main> out of scroll for the drawing surface's
          // sake. This panel is a sibling of the canvas, not part of it, so it
          // opts back into ordinary vertical panning — otherwise a criterion
          // list longer than the window is unreachable by touch on a tablet.
          touchAction: "pan-y",
        }}
      >
        <div className="shrink-0 h-11 px-3 border-b flex items-center justify-between gap-2">
          <span className="text-sm font-medium truncate">
            {student?.name ?? "No student"}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={grading.handleClear}
            disabled={grading.saving || !student?.grade}
            title="Clear grade"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
        <RubricGradingPanel grading={grading} dense />
      </aside>
    </TooltipProvider>
  );
}
