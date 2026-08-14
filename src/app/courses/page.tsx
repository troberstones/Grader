import { getCourses, getCourseTerms, getMyTermPreference, getActiveCourse } from "@/actions/courses";
import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { CreateCourseDialog } from "./create-course-dialog";
import { CoursesBrowser } from "./courses-browser";

export default async function CoursesPage() {
  const [allCourses, terms, preference, activeCourse] = await Promise.all([
    getCourses(),
    getCourseTerms(),
    getMyTermPreference(),
    getActiveCourse(),
  ]);

  return (
    <PageContainer>
      <Header
        title="Courses"
        description="Manage your courses and student rosters"
        actions={<CreateCourseDialog />}
      />
      <CoursesBrowser
        courses={allCourses}
        terms={terms}
        initialSelection={preference}
        initialActiveCourseId={activeCourse?.id ?? null}
      />
    </PageContainer>
  );
}
