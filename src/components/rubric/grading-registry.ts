import type { ComponentType } from "react";
import { LegacyGradingView } from "./legacy-grading-view";
import { V3GradingViewAdapter } from "./v3-grading-view-adapter";
import { ShareGradingSliderView } from "./share-grading-slider-view";
import { ShareGradingMatrixView } from "./share-grading-matrix-view";
import type { PointsGrading, ShareGrading } from "@/hooks/use-rubric-grading";

/**
 * Grading-time counterpart to `registry.ts`. A `Record`, not an array like
 * the editor registry: there are exactly two share-model variants plus one
 * permanently-frozen legacy path (no rubric will ever be freshly authored
 * under it again once the old editors are gone from anyone's workflow), so a
 * `Record` gives a compiler error if the key union ever grows without a
 * matching entry — an array `.find()` would degrade silently to `undefined`
 * instead.
 */
export const RUBRIC_GRADING_VIEWS: {
  legacy: ComponentType<{ grading: PointsGrading }>;
  v3: ComponentType<{ grading: PointsGrading }>;
  "share-slider": ComponentType<{ grading: ShareGrading }>;
  "share-matrix": ComponentType<{ grading: ShareGrading }>;
} = {
  legacy: LegacyGradingView,
  v3: V3GradingViewAdapter,
  "share-slider": ShareGradingSliderView,
  "share-matrix": ShareGradingMatrixView,
};

export type RubricGradingViewKey = keyof typeof RUBRIC_GRADING_VIEWS;
