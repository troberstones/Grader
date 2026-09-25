import { getGradeSheet } from "@/actions/grades";
import { getAssignment } from "@/actions/assignments";
import { GradingShell } from "@/components/shared/grading-shell";

export const dynamic = "force-dynamic";

export default async function AssignmentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  const [students, assignment] = await Promise.all([
    getGradeSheet(Number(assignmentId)),
    getAssignment(Number(assignmentId)),
  ]);

  return (
    <GradingShell
      students={students}
      assignmentId={Number(assignmentId)}
      pointsPossible={assignment?.pointsPossible ?? 0}
    >
      {children}
    </GradingShell>
  );
}
