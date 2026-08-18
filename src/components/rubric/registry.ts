import type { ComponentType } from "react";
import { RubricEditor } from "./rubric-editor";
import { RubricEditorV2 } from "./rubric-editor-v2";
import { RubricEditorV3 } from "./rubric-editor-v3";
import { ShareRubricEditor } from "./share-editor/share-rubric-editor";
import type { RubricJSON } from "@/types/rubric";
import type { AuthoredRubric, NormalRubric } from "@/lib/rubric";

/**
 * The registry the "modular for swapping" ask was about. `new/page.tsx` and
 * `edit-rubric-client.tsx` both read from this single array instead of each
 * hardcoding its own version-toggle ternary. Adding a future 5th editor is a
 * data addition here, not a find-and-replace across pages.
 *
 * Not one uniform prop signature: v1/v2/v3 are typed around the legacy
 * `RubricJSON` (explicit points, untouched on purpose) and `share` around
 * the dimensionless `AuthoredRubric`/`NormalRubric` — genuinely different
 * shapes. `kind` lets each page pick the right save action and initialData
 * mapping per entry without pretending the two families are the same.
 */
export type RubricEditorEntry =
  | {
      key: "v1" | "v2" | "v3";
      label: string;
      kind: "legacy";
      Editor: ComponentType<{ initialData?: RubricJSON; onSave: (data: RubricJSON) => Promise<void>; saving?: boolean }>;
    }
  | {
      key: "share";
      label: string;
      kind: "share";
      Editor: ComponentType<{ initialData?: NormalRubric | null; onSave: (rubric: AuthoredRubric) => Promise<void>; saving?: boolean }>;
    };

export const RUBRIC_EDITORS: RubricEditorEntry[] = [
  { key: "v1", label: "Classic", kind: "legacy", Editor: RubricEditor },
  { key: "v2", label: "Weighted", kind: "legacy", Editor: RubricEditorV2 },
  { key: "v3", label: "Spreadsheet", kind: "legacy", Editor: RubricEditorV3 },
  { key: "share", label: "Share (new)", kind: "share", Editor: ShareRubricEditor },
];

export type RubricEditorKey = RubricEditorEntry["key"];
