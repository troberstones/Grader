"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** What a delete server action returns instead of throwing for a refusal it wants shown verbatim. */
export type DeleteConfirmOutcome = { ok: true } | { ok: false; message: string };

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Display name of the thing being deleted, used in both prompts. */
  itemName: string;
  /** What kind of thing this is, for the title — e.g. "course", "assignment", "rubric". */
  itemKind: string;
  /** Called only after both confirmations. Return `{ok:false, message}` instead of throwing for a refusal the dialog should show. */
  onDelete: () => Promise<DeleteConfirmOutcome>;
  /** Omit to hide "Archive instead" — rubrics have no archive concept. */
  onArchive?: () => Promise<void>;
  /** Called after a successful permanent delete, once the dialog has closed. */
  onDeleted?: () => void;
  /** Called after a successful archive, once the dialog has closed. */
  onArchived?: () => void;
}

/**
 * Double-confirmation delete flow shared by course/assignment/rubric delete
 * buttons: "are you sure?" then "are you REALLY sure, or would you rather
 * archive?". The actual delete only ever runs after both confirmations, and
 * a server refusal (graded course/assignment, rubric in use) is shown as a
 * toast instead of silently failing or throwing past a try/catch the caller
 * forgot to add.
 */
export function DeleteConfirmDialog({
  open,
  onOpenChange,
  itemName,
  itemKind,
  onDelete,
  onArchive,
  onDeleted,
  onArchived,
}: DeleteConfirmDialogProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [pending, setPending] = useState(false);

  function close() {
    onOpenChange(false);
    // Let the close animation finish before resetting to step 1, so the
    // dialog doesn't visibly jump back to the first prompt as it fades out.
    setTimeout(() => setStep(1), 200);
  }

  async function handleDelete() {
    setPending(true);
    try {
      const result = await onDelete();
      if (!result.ok) {
        toast.error(result.message);
        close();
        return;
      }
      toast.success(`${itemName} deleted`);
      close();
      onDeleted?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setPending(false);
    }
  }

  async function handleArchive() {
    if (!onArchive) return;
    setPending(true);
    try {
      await onArchive();
      toast.success(`${itemName} archived`);
      close();
      onArchived?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Archive failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(next) : close())}>
      <DialogContent>
        {step === 1 ? (
          <>
            <DialogHeader>
              <DialogTitle>Delete this {itemKind}?</DialogTitle>
              <DialogDescription>Are you sure you want to delete {itemName}?</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={pending}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => setStep(2)} disabled={pending}>
                Continue
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Are you really sure?</DialogTitle>
              <DialogDescription>
                This permanently deletes {itemName} and can&apos;t be undone.
                {onArchive ? " Would you rather archive it?" : ""}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              {onArchive && (
                <Button variant="secondary" onClick={handleArchive} disabled={pending}>
                  Archive instead
                </Button>
              )}
              <Button variant="destructive" onClick={handleDelete} disabled={pending}>
                {pending ? "Deleting…" : "Delete permanently"}
              </Button>
              <Button variant="outline" onClick={close} disabled={pending}>
                Cancel
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
