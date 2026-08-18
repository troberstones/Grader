import { notFound } from "next/navigation";
import { getCourse } from "@/actions/courses";
import { getMyCourseRole } from "@/actions/course-members";
import { CourseNav } from "./course-nav";

export default async function CourseLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const course = await getCourse(Number(courseId));
  if (!course) notFound();
  const viewerRole = await getMyCourseRole(course.id);

  return (
    <div className="flex items-start">
      <CourseNav courseId={course.id} courseName={course.name} courseCode={course.code} viewerRole={viewerRole} />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
