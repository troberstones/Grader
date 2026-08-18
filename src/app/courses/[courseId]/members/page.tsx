import { notFound } from "next/navigation";
import { getCourse } from "@/actions/courses";
import { listCourseMembers } from "@/actions/course-members";
import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { MembersTable } from "./members-table";
import { AddMemberDialog } from "./add-member-dialog";

export default async function MembersPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const course = await getCourse(Number(courseId));
  if (!course) notFound();

  // course.members.manage is owner-only — a non-owner member never reaches
  // this page (no link is rendered for them either, see course-nav.tsx), so
  // an error here is a real permission problem, not a page to soften.
  const members = await listCourseMembers(course.id);

  return (
    <PageContainer>
      <Header
        title={`Members - ${course.name}`}
        description={`${members.length} member${members.length === 1 ? "" : "s"}`}
        actions={<AddMemberDialog courseId={course.id} />}
      />
      <MembersTable members={members} courseId={course.id} />
    </PageContainer>
  );
}
