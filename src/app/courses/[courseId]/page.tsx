import Link from "next/link";
import { notFound } from "next/navigation";
import { getCourse } from "@/actions/courses";
import { getEnrollmentCount } from "@/actions/students";
import { getAssignmentsForCourse } from "@/actions/assignments";
import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { LinkButton } from "@/components/ui/link-button";
import { LsSyncAssignmentsButton } from "@/components/ls-bridge/ls-sync-assignments-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Plus, ClipboardList, Calendar, Pencil } from "lucide-react";
import { formatTerm } from "@/lib/terms";
import { TrackActiveCourse } from "./track-active-course";
import { CopyCourseDialog } from "./copy-course-dialog";

export const dynamic = "force-dynamic";

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const [course, studentCount, assignments] = await Promise.all([
    getCourse(Number(courseId)),
    getEnrollmentCount(Number(courseId)),
    getAssignmentsForCourse(Number(courseId)),
  ]);
  if (!course) notFound();

  return (
    <PageContainer>
      <TrackActiveCourse courseId={course.id} />
      <Header
        title={course.name}
        description={`${course.code}${course.section ? ` · Section ${course.section}` : ""} · ${formatTerm(course.year, course.term)}`}
        actions={
          <div className="flex gap-2">
            <LsSyncAssignmentsButton courseId={course.id} />
            <CopyCourseDialog sourceId={course.id} sourceName={course.name} sourceHasStartDate={!!course.startDate} />
            <LinkButton href={`/courses/${course.id}/roster`} variant="outline">
              <Users className="mr-2 h-4 w-4" />
              Roster ({studentCount})
            </LinkButton>
            <LinkButton href={`/assignments/new?courseId=${course.id}`}>
              <Plus className="mr-2 h-4 w-4" />
              New Assignment
            </LinkButton>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-2 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Students</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{studentCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Assignments</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{assignments.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Assignments */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Assignments</h3>
          <LinkButton href={`/assignments/new?courseId=${course.id}`} variant="ghost" className="text-sm">
            <Plus className="h-4 w-4 mr-1" />
            New
          </LinkButton>
        </div>

        {assignments.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground border rounded-lg">
            <ClipboardList className="mx-auto h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">No assignments yet.</p>
            <LinkButton
              href={`/assignments/new?courseId=${course.id}`}
              variant="link"
              className="mt-2 text-sm"
            >
              Create your first assignment
            </LinkButton>
          </div>
        ) : (
          <div className="rounded-xl border divide-y divide-border overflow-hidden">
            {assignments.map((a) => (
              <div key={a.id} className="flex items-center gap-4 px-4 py-2.5 hover:bg-muted/40 transition-colors">
                <Link href={`/assignments/${a.id}`} className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{a.name}</span>
                    {a.rubricName && (
                      <Badge variant="secondary" className="text-xs">
                        {a.rubricName}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                    {a.dueDate && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        Due {new Date(a.dueDate).toLocaleDateString()}
                      </span>
                    )}
                    <span>{a.pointsPossible} pts</span>
                  </div>
                </Link>
                <Link
                  href={`/assignments/${a.id}/edit`}
                  className="shrink-0 p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  title="Edit assignment"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageContainer>
  );
}
