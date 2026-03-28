import { getGradeSheet } from "@/actions/grades";
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
  const students = await getGradeSheet(Number(assignmentId));

  return (
    <GradingShell students={students}>
      {children}
    </GradingShell>
  );
}
