# Archived rubric editors and grading views

These are the rubric systems the app ran on before the share model. They are
kept here, out of the build, so they can be read and retrieved — not because
anything still calls them. **Nothing in `src/` imports this directory**, and it
is excluded from TypeScript (`tsconfig.json`) and ESLint (`eslint.config.mjs`),
so the code here is not type-checked and will drift from the live types.

## What is here

| File | What it was |
| --- | --- |
| `rubric-editor.tsx` | "Classic" (v1) editor — a point value typed into every cell. |
| `rubric-editor-v2.tsx` | "Weighted" (v2) — relative weights, points derived on a 100-point basis. |
| `rubric-editor-v3.tsx` | "Spreadsheet" (v3) — grid editing, weight bar, draggable letter-grade band strip. |
| `legacy-grading-view.tsx` | Grading UI for v1/v2 rubrics: click a level, add up its points. |
| `v3-grading-view.tsx`, `v3-grading-view-adapter.tsx` | Grading UI for v3 rubrics: fluid per-criterion sliders. |
| `rubric-preview.tsx`, `rubric-table.tsx`, `rubric-cell.tsx`, `rubric-score-summary.tsx` | The read-only point-based rubric grid. `rubric-preview.tsx` already had no callers when it was archived. |

## Why they were archived

They author into the points model, and the points model is what
`docs/rubric-authoring.md` documents as miscalibrated: work described as
"Good with Minor Flaws" in every category earned a C−. Every rubric in the
database was converted to the share model
(`scripts/convert-legacy-rubrics-to-share.mjs`), which preserves each recorded
grade's exact percentage, so there was nothing left for these to open.

## Retrieving one

They were archived unmodified, so they still import things the live app no
longer has. To bring one back you need both the file and the support it was
written against:

1. `git mv src/components/rubric/_archive/<file> src/components/rubric/`
2. Re-add what it imports. `RubricJSON` (`src/types/rubric.ts`) and
   `createRubric` (`src/actions/rubrics.ts`) are still present. Three things
   were removed along with these files and have to come back from git — find
   the archiving commit, then read the previous version of each:

   ```
   git show <archive-commit>^:src/actions/rubrics.ts        # updateRubric, importRubricFromJSON
   git show <archive-commit>^:src/hooks/use-rubric-grading.ts   # the PointsGrading half
   ```

   The editors need `updateRubric`; the grading views need `PointsGrading`.
3. Re-register it in `registry.ts` (editors) or `grading-registry.ts` (grading
   views) — both were narrowed to one shape, so the legacy entry's `kind`
   discriminant has to come back with it — and drop the path back out of the
   `tsconfig.json` / `eslint.config.mjs` exclusions.

A rubric already converted to the share model will not open in a restored
legacy editor: its levels have `points: null`. The conversion deliberately left
the original `points` values in place on rubrics it converted, so reversing one
is a matter of clearing `settings.model`, not of reconstructing data.
