import type { ComponentType } from "react";
import { ShareGradingSliderView } from "./share-grading-slider-view";
import { ShareGradingMatrixView } from "./share-grading-matrix-view";
import type { ShareGrading } from "@/hooks/use-rubric-grading";

/**
 * Grading-time counterpart to `registry.ts`: the two ways to grade a share
 * rubric, and the only two grading surfaces the app has.
 *
 * - `matrix` — tap a level in the grid. Touch-first, no drag, no nudge.
 * - `slider` — drag along every (level, nudge) position on a 0-100 scale.
 *
 * They read and write exactly the same thing, a level per criterion, so the
 * choice is ergonomic rather than pedagogical and is remembered per browser.
 * The points-model views they replaced are archived under `_archive/`.
 *
 * A `Record`, not an array: the key union is closed, so the compiler flags a
 * key added without an entry, where an array `.find()` would quietly hand back
 * `undefined`.
 */
export const RUBRIC_GRADING_VIEWS: Record<
  RubricGradingViewKey,
  ComponentType<{ grading: ShareGrading }>
> = {
  matrix: ShareGradingMatrixView,
  slider: ShareGradingSliderView,
};

export type RubricGradingViewKey = "matrix" | "slider";

export const GRADING_VIEW_LABELS: Record<RubricGradingViewKey, string> = {
  matrix: "Grid",
  slider: "Slider",
};
