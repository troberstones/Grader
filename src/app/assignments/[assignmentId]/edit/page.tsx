import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getAssignment } from "@/actions/assignments";
import { requireGradeSession } from "@/lib/auth/session";
import { getCourses } from "@/actions/courses";
import { getRubrics } from "@/actions/rubrics";
import { EditAssignmentClient } from "./edit-assignment-client";

export const dynamic = "force-dynamic";

export default async function EditAssignmentPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  await requireGradeSession(`/assignments/${assignmentId}/review`);
  const [assignment, courses, rubrics] = await Promise.all([
    getAssignment(Number(assignmentId)),
    getCourses(),
    getRubrics(),
  ]);

  if (!assignment) notFound();

  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">Loading…</div>}>
      <EditAssignmentClient
        assignment={assignment}
        courses={courses}
        rubrics={rubrics}
      />
    </Suspense>
  );
}
