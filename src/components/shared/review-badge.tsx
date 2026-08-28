"use client";

import { Image as ImageIcon } from "lucide-react";
import { useIsReviewing } from "./session-mode";

/**
 * Says, on screen, that this session cannot grade.
 *
 * Without it review mode is invisible until something is missing, and "where
 * did the rubric go" is a bad thing to wonder about in front of a class. It
 * also states the way out, because there is exactly one — the mode is fixed for
 * the life of the session, so the answer is always to sign out and back in.
 */
export function ReviewBadge({ className }: { className?: string }) {
  if (!useIsReviewing()) return null;

  return (
    <span
      title="Review session — grading and editing are unavailable until you sign out and back in."
      className={
        "flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-medium text-primary " +
        (className ?? "")
      }
    >
      <ImageIcon className="h-3.5 w-3.5 shrink-0" />
      Review
    </span>
  );
}
