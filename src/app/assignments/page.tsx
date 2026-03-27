import Link from "next/link";
import { getAllAssignments } from "@/actions/assignments";
import { getCourses } from "@/actions/courses";
import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { LinkButton } from "@/components/ui/link-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, BookOpen, Calendar, ClipboardList, Pencil } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AssignmentsPage() {
  const [assignments, courses] = await Promise.all([getAllAssignments(), getCourses()]);

  // Group by course
  const byCourse = courses
    .filter((c) => !c.archived)
    .map((course) => ({
      course,
      assignments: assignments.filter((a) => a.courseId === course.id),
    }))
    .filter((group) => group.assignments.length > 0);

  const unassigned = assignments.filter(
    (a) => !courses.find((c) => c.id === a.courseId)
  );

  return (
    <PageContainer>
      <Header
        title="Assignments"
        description="Manage grading assignments across all courses"
        actions={
          <LinkButton href="/assignments/new">
            <Plus className="mr-2 h-4 w-4" />
            New Assignment
          </LinkButton>
        }
      />

      {assignments.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <ClipboardList className="mx-auto h-12 w-12 mb-4 opacity-30" />
          <p className="text-lg font-medium mb-1">No assignments yet</p>
          <p className="text-sm mb-4">Create an assignment and link it to a rubric to start grading.</p>
          <LinkButton href="/assignments/new">Create your first assignment</LinkButton>
        </div>
      ) : (
        <div className="space-y-8">
          {byCourse.map(({ course, assignments: courseAssignments }) => (
            <div key={course.id}>
              <div className="flex items-center gap-2 mb-3">
                <BookOpen className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                  {course.code} — {course.name}
                  <span className="ml-2 font-normal normal-case">{course.semester}</span>
                </h2>
              </div>
              <div className="space-y-2">
                {courseAssignments.map((a) => (
                  <AssignmentRow key={a.id} assignment={a} />
                ))}
              </div>
            </div>
          ))}
          {unassigned.length > 0 && (
            <div>
              <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-3">
                Other
              </h2>
              {unassigned.map((a) => (
                <AssignmentRow key={a.id} assignment={a} />
              ))}
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}

type AssignmentRow = Awaited<ReturnType<typeof getAllAssignments>>[number];

function AssignmentRow({ assignment: a }: { assignment: AssignmentRow }) {
  return (
    <Card className="hover:border-primary/50 transition-colors">
      <CardContent className="px-4 py-3 flex items-center gap-4">
        <Link href={`/assignments/${a.id}`} className="flex-1 min-w-0 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium truncate">{a.name}</span>
              {a.rubricName && (
                <Badge variant="secondary" className="text-xs shrink-0">
                  {a.rubricName}
                </Badge>
              )}
            </div>
            {a.dueDate && (
              <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3" />
                Due {new Date(a.dueDate).toLocaleDateString()}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-sm text-muted-foreground">{a.pointsPossible} pts</span>
            <Badge variant="outline" className="text-xs capitalize">
              {a.submissionType}
            </Badge>
          </div>
        </Link>
        <Link
          href={`/assignments/${a.id}/edit`}
          className="shrink-0 p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title="Edit assignment"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
}
