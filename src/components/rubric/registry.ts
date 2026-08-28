import type { ComponentType } from "react";
import { ShareRubricEditor } from "./share-editor/share-rubric-editor";
import type { AuthoredRubric, NormalRubric } from "@/lib/rubric";

/**
 * The rubric editors the app offers.
 *
 * One, now. The Classic / Weighted / Spreadsheet editors that used to sit
 * beside it authored into the points model and are archived under
 * `_archive/` — see the README there for why and how to retrieve one.
 *
 * The registry survives the cull on purpose: the pages that render an editor
 * read from this array rather than naming a component, so adding a second one
 * back is a data change here, and a single entry makes the version toggle
 * disappear on its own (`RUBRIC_EDITORS.length > 1`) rather than rendering a
 * one-button switch.
 */
export interface RubricEditorEntry {
  key: "share";
  label: string;
  Editor: ComponentType<{
    initialData?: NormalRubric | null;
    onSave: (rubric: AuthoredRubric) => Promise<void>;
    saving?: boolean;
  }>;
}

export const RUBRIC_EDITORS: RubricEditorEntry[] = [
  { key: "share", label: "Rubric", Editor: ShareRubricEditor },
];

export type RubricEditorKey = RubricEditorEntry["key"];
