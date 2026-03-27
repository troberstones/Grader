import { notFound } from "next/navigation";
import { getAssignment } from "@/actions/assignments";
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
  const [assignment, courses, rubrics] = await Promise.all([
    getAssignment(Number(assignmentId)),
    getCourses(),
    getRubrics(),
  ]);

  if (!assignment) notFound();

  return (
    <EditAssignmentClient
      assignment={assignment}
      courses={courses}
      rubrics={rubrics}
    />
  );
}
