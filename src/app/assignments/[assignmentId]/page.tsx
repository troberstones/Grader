import { notFound } from "next/navigation";
import { getAssignment } from "@/actions/assignments";
import { getGradeSheet } from "@/actions/grades";
import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { LinkButton } from "@/components/ui/link-button";
import { GradeSheetClient } from "./grade-sheet-client";
import { Calendar, BookOpen, Pencil } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AssignmentGradeSheetPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  const [assignment, students] = await Promise.all([
    getAssignment(Number(assignmentId)),
    getGradeSheet(Number(assignmentId)),
  ]);

  if (!assignment) notFound();

  const gradedCount = students.filter((s) => s.grade?.status === "graded").length;
  const inProgressCount = students.filter((s) => s.grade?.status === "in_progress").length;

  return (
    <PageContainer>
      <Header
        title={assignment.name}
        description={
          <span className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <BookOpen className="h-3.5 w-3.5" />
              {assignment.course.code} — {assignment.course.name}
            </span>
            {assignment.dueDate && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                Due {new Date(assignment.dueDate).toLocaleDateString()}
              </span>
            )}
            <span className="text-foreground font-medium">{assignment.pointsPossible} pts</span>
            {assignment.rubric && (
              <span className="text-xs bg-secondary px-2 py-0.5 rounded">
                {assignment.rubric.name}
              </span>
            )}
          </span>
        }
        actions={
          <div className="flex gap-2">
            <LinkButton href={`/assignments/${assignment.id}/edit`} variant="outline">
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </LinkButton>
            <LinkButton href={`/courses/${assignment.courseId}`} variant="outline">
              Back to Course
            </LinkButton>
          </div>
        }
      />

      <GradeSheetClient
        assignment={assignment}
        students={students}
        gradedCount={gradedCount}
        inProgressCount={inProgressCount}
      />
    </PageContainer>
  );
}
