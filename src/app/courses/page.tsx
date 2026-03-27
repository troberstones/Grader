import { getCourses } from "@/actions/courses";
import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { CreateCourseDialog } from "./create-course-dialog";
import { CourseList } from "./course-list";

export default async function CoursesPage() {
  const allCourses = await getCourses();

  return (
    <PageContainer>
      <Header
        title="Courses"
        description="Manage your courses and student rosters"
        actions={<CreateCourseDialog />}
      />
      <CourseList courses={allCourses} />
    </PageContainer>
  );
}
