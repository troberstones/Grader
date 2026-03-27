import { notFound } from "next/navigation";
import { getCourse } from "@/actions/courses";
import { getStudentsForCourse } from "@/actions/students";
import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { RosterTable } from "./roster-table";
import { ImportRosterDialog } from "./import-roster-dialog";

export default async function RosterPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const course = await getCourse(Number(courseId));
  if (!course) notFound();

  const students = await getStudentsForCourse(course.id);

  return (
    <PageContainer>
      <Header
        title={`Roster - ${course.name}`}
        description={`${students.length} students enrolled`}
        actions={<ImportRosterDialog courseId={course.id} />}
      />
      <RosterTable students={students} courseId={course.id} />
    </PageContainer>
  );
}
