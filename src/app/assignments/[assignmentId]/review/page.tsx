import { notFound } from "next/navigation";
import { getAssignment } from "@/actions/assignments";
import { getGradeSheet } from "@/actions/grades";
import { getSubmissionsForAssignment } from "@/actions/submissions";
import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { LinkButton } from "@/components/ui/link-button";
import { ReviewClient } from "./review-client";
import { ArrowLeft, BookOpen, ClipboardList } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  const [assignment, students, submissions] = await Promise.all([
    getAssignment(Number(assignmentId)),
    getGradeSheet(Number(assignmentId)),
    getSubmissionsForAssignment(Number(assignmentId)),
  ]);

  if (!assignment) notFound();

  // Map submissions by studentId for quick lookup
  const submissionMap = Object.fromEntries(submissions.map((s) => [s.studentId, s]));

  return (
    <PageContainer>
      <Header
        title={`Review: ${assignment.name}`}
        description={
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5" />
            {assignment.course.code} — {assignment.course.name}
          </span>
        }
        actions={
          <div className="flex gap-2">
            <LinkButton href={`/assignments/${assignment.id}`} variant="outline">
              <ClipboardList className="h-4 w-4" />
              Grade Sheet
            </LinkButton>
            <LinkButton href={`/courses/${assignment.courseId}`} variant="outline">
              <ArrowLeft className="h-4 w-4" />
              Back to Course
            </LinkButton>
          </div>
        }
      />

      <ReviewClient
        assignment={assignment}
        students={students}
        initialSubmissions={submissionMap}
      />
    </PageContainer>
  );
}
