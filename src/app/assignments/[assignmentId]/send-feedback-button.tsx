"use client";

import { SendFeedbackDialog } from "@/components/feedback/send-feedback-dialog";
import { useGrading } from "@/components/shared/grading-context";

/** The grade sheet's copy of the dialog, which also updates the sidebar's emailed marks as each send lands. */
export function SendFeedbackButton({ assignmentId }: { assignmentId: number }) {
  const { recordFeedbackEmailed } = useGrading();
  return (
    <SendFeedbackDialog
      assignmentId={assignmentId}
      onSent={(studentId, lastSent) => recordFeedbackEmailed(studentId, lastSent.sentAt, lastSent.fingerprint)}
    />
  );
}
