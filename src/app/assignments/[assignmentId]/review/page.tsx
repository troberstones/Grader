import { notFound } from "next/navigation";
import { getAssignment } from "@/actions/assignments";
import { getGradeSheet } from "@/actions/grades";
import { getSubmissionsForAssignment } from "@/actions/submissions";
import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { LinkButton } from "@/components/ui/link-button";
import { ReviewClient } from "./review-client";
import { ArrowLeft, BookOpen } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ assignmentId: string }>;
  searchParams: Promise<{ studentId?: string }>;
}) {
  const [{ assignmentId }, { studentId }] = await Promise.all([params, searchParams]);
  const initialStudentId = studentId ? Number(studentId) : undefined;
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
          <LinkButton href={`/courses/${assignment.courseId}`} variant="outline">
            <ArrowLeft className="h-4 w-4" />
            Back to Course
          </LinkButton>
        }
      />

      <ReviewClient
        assignment={assignment}
        students={students}
        initialSubmissions={submissionMap}
        initialStudentId={initialStudentId}
      />
    </PageContainer>
  );
}
