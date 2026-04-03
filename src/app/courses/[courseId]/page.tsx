import Link from "next/link";
import { notFound } from "next/navigation";
import { getCourse } from "@/actions/courses";
import { getStudentsForCourse } from "@/actions/students";
import { getAssignmentsForCourse } from "@/actions/assignments";
import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { LinkButton } from "@/components/ui/link-button";
import { LsSyncAssignmentsButton } from "@/components/ls-bridge/ls-sync-assignments-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Plus, ClipboardList, Calendar, CheckCircle2, Clock, Circle, Pencil } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const [course, students, assignments] = await Promise.all([
    getCourse(Number(courseId)),
    getStudentsForCourse(Number(courseId)),
    getAssignmentsForCourse(Number(courseId)),
  ]);
  if (!course) notFound();

  const totalGraded = assignments.reduce((sum, a) => sum + a.stats.graded, 0);
  const totalStudentAssignments = assignments.reduce(
    (sum, a) => sum + a.stats.total,
    0
  );

  return (
    <PageContainer>
      <Header
        title={course.name}
        description={`${course.code}${course.section ? ` · Section ${course.section}` : ""} · ${course.semester}`}
        actions={
          <div className="flex gap-2">
            <LsSyncAssignmentsButton courseId={course.id} />
            <LinkButton href={`/courses/${course.id}/roster`} variant="outline">
              <Users className="mr-2 h-4 w-4" />
              Roster ({students.length})
            </LinkButton>
            <LinkButton href={`/assignments/new?courseId=${course.id}`}>
              <Plus className="mr-2 h-4 w-4" />
              New Assignment
            </LinkButton>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Students</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{students.length}</div>
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
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Grades Entered</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totalGraded}
              {totalStudentAssignments > 0 && (
                <span className="text-base font-normal text-muted-foreground ml-1">
                  / {totalStudentAssignments}
                </span>
              )}
            </div>
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
          <div className="space-y-2">
            {assignments.map((a) => {
              const pct =
                a.stats.total > 0
                  ? Math.round((a.stats.graded / a.stats.total) * 100)
                  : 0;

              return (
                <Card key={a.id} className="hover:border-primary/50 transition-colors">
                  <CardContent className="px-4 py-3">
                    <div className="flex items-start gap-4">
                      <Link href={`/assignments/${a.id}`} className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{a.name}</span>
                          {a.rubricName && (
                            <Badge variant="secondary" className="text-xs">
                              {a.rubricName}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                          {a.dueDate && (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              Due {new Date(a.dueDate).toLocaleDateString()}
                            </span>
                          )}
                          <span>{a.pointsPossible} pts</span>
                          {a.stats.total > 0 && (
                            <span className="flex items-center gap-1">
                              {a.stats.graded === a.stats.total ? (
                                <CheckCircle2 className="h-3 w-3 text-green-500" />
                              ) : a.stats.graded > 0 || a.stats.inProgress > 0 ? (
                                <Clock className="h-3 w-3 text-yellow-500" />
                              ) : (
                                <Circle className="h-3 w-3" />
                              )}
                              {a.stats.graded}/{a.stats.total} graded
                            </span>
                          )}
                        </div>
                      </Link>

                      <div className="flex items-center gap-3 shrink-0">
                        {/* Progress bar */}
                        {a.stats.total > 0 && (
                          <div className="w-20">
                            <div className="text-xs text-right text-muted-foreground mb-1">
                              {pct}%
                            </div>
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full bg-green-500 transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        )}
                        <Link
                          href={`/assignments/${a.id}/edit`}
                          className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          title="Edit assignment"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </PageContainer>
  );
}
