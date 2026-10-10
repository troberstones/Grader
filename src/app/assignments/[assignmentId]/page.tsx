import { notFound } from "next/navigation";
import { getAssignment } from "@/actions/assignments";
import { requireGradeSession } from "@/lib/auth/session";
import { LinkButton } from "@/components/ui/link-button";
import { GradeSheetClient } from "./grade-sheet-client";
import { SendUploadLinkDialog } from "./send-upload-link-dialog";
import { SendFeedbackButton } from "./send-feedback-button";
import { UploadZipButton } from "./upload-zip-button";
import { IngestCommentsDialog } from "./ingest-comments-dialog";
import { Calendar, BookOpen, Pencil } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AssignmentGradeSheetPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  // The rubric and every score live on this page, so a review session is sent
  // to the artwork for the same assignment rather than shown a refusal.
  await requireGradeSession(`/assignments/${assignmentId}/review`);
  const assignment = await getAssignment(Number(assignmentId));

  if (!assignment) notFound();

  return (
    <div className="flex h-full flex-col">
      {/* One compact strip rather than the shared page Header: on this page
          every row spent on chrome is a rubric row pushed off the window. */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b px-4 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold tracking-tight leading-tight">
            {assignment.name}
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <BookOpen className="h-3 w-3" />
              {assignment.course.code} — {assignment.course.name}
            </span>
            {assignment.dueDate && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Due {new Date(assignment.dueDate).toLocaleDateString()}
              </span>
            )}
            <span className="text-foreground font-medium">{assignment.pointsPossible} pts</span>
            {assignment.rubric && (
              <span className="bg-secondary px-1.5 rounded">{assignment.rubric.name}</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <SendFeedbackButton assignmentId={assignment.id} />
          <SendUploadLinkDialog assignmentId={assignment.id} courseId={assignment.courseId} />
          <UploadZipButton assignmentId={assignment.id} />
          <IngestCommentsDialog
            assignmentId={assignment.id}
            assignmentName={assignment.name}
            courseId={assignment.courseId}
          />
          <LinkButton href={`/assignments/${assignment.id}/edit`} variant="outline" size="sm">
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </LinkButton>
          <LinkButton href={`/courses/${assignment.courseId}`} variant="outline" size="sm">
            Back to Course
          </LinkButton>
        </div>
      </div>

      <GradeSheetClient assignment={assignment} />
    </div>
  );
}
