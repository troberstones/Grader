import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The two persistent notices `RubricGradingPanel` can show above the grading
 * view — neither is a toast, because a toast is gone by the time anyone
 * notices the edit it was about never actually landed (same reasoning as the
 * "Unsaved changes — Retry" indicator these sit alongside).
 *
 * - `conflict`: `saveShareGrade` rejected a save because someone else had
 *   already saved this grade since it was last read (see `baseUpdatedAt` in
 *   src/actions/grades.ts). The grader picks whose version wins.
 * - `auth`: the session is missing/expired, or no longer has the capability
 *   (a typed `{ reason:"auth" }` from the action — see
 *   src/lib/auth/require.ts's `AuthError`). Signing in again happens in a new
 *   tab so the current edit, still held only in this tab's memory, is never
 *   thrown away by a navigation.
 */
export type GradingAlert =
  | { kind: "conflict"; onLoadTheirs: () => void; onKeepMine: () => void }
  | { kind: "auth"; onRetry: () => void };

export function GradingAlertBanner({ alert }: { alert: GradingAlert }) {
  const message =
    alert.kind === "conflict"
      ? "This grade was changed on another device."
      : "Your session expired — sign in again in a new tab, then click Retry.";

  return (
    <div
      role="alert"
      className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1 min-w-[14rem]">{message}</span>
      {alert.kind === "conflict" ? (
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={alert.onLoadTheirs}>
            Load theirs
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={alert.onKeepMine}>
            Keep mine
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <a
            href="/login"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline underline-offset-2 hover:no-underline"
          >
            Open sign-in
          </a>
          <Button type="button" size="sm" variant="outline" onClick={alert.onRetry}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
