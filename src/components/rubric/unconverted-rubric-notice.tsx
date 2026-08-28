import { AlertTriangle } from "lucide-react";

/**
 * Shown wherever a rubric authored by the archived points-based editors turns
 * up — the rubric editor, and the grading panel.
 *
 * It is a dead end on purpose. Such a rubric carries level points but no band
 * edges, so anything that scored or re-saved it would be applying a
 * calibration it was never written against, and quietly moving the grades of
 * everyone already marked against it. The conversion is a deliberate,
 * reversible, one-command step instead — and it preserves every recorded
 * percentage exactly.
 */
export function UnconvertedRubricNotice({ name }: { name?: string }) {
  return (
    <div className="rounded-md bg-surface-container p-6 space-y-4 max-w-2xl">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-primary shrink-0" />
        <h2 className="font-medium">
          {name ? `“${name}” needs converting` : "This rubric needs converting"}
        </h2>
      </div>
      <div className="space-y-3 text-sm text-muted-foreground">
        <p>
          It was authored in one of the older rubric editors, which have been archived. Those stored a
          point value on every level; the current model stores relative shares and one calibration for
          the whole rubric, and computes the points from the assignment.
        </p>
        <p>
          Converting is one command, and it keeps every grade already recorded against this rubric at
          the exact percentage it has now:
        </p>
        <pre className="rounded bg-surface-container-lowest px-3 py-2 text-xs overflow-x-auto">
          node scripts/convert-legacy-rubrics-to-share.mjs --apply
        </pre>
        <p>
          Run it without <code>--apply</code> first for a report of what would change. The original
          point values are left in place, so the conversion can be undone.
        </p>
      </div>
    </div>
  );
}
