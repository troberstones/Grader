import {
  getCourses,
  getCourseTerms,
  getMyTermPreference,
  getActiveCourse,
  getCoursesForCopy,
  getCourseTermsForCopy,
} from "@/actions/courses";
import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { CreateCourseDialog } from "./create-course-dialog";
import { CoursesBrowser } from "./courses-browser";
import { CopyCoursePicker } from "./copy-course-picker";

export default async function CoursesPage() {
  const [allCourses, terms, preference, activeCourse, coursesForCopy, termsForCopy] = await Promise.all([
    getCourses(),
    getCourseTerms(),
    getMyTermPreference(),
    getActiveCourse(),
    getCoursesForCopy(),
    getCourseTermsForCopy(),
  ]);

  return (
    <PageContainer>
      <Header
        title="Courses"
        description="Manage your courses and student rosters"
        actions={
          <div className="flex gap-2">
            <CopyCoursePicker courses={coursesForCopy} terms={termsForCopy} />
            <CreateCourseDialog />
          </div>
        }
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
