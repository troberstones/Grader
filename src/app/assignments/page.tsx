import Link from "next/link";
import { getAssignmentsForCourse } from "@/actions/assignments";
import { getActiveCourse } from "@/actions/courses";
import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { LinkButton } from "@/components/ui/link-button";
import { Badge } from "@/components/ui/badge";
import { Plus, Calendar, ClipboardList, Pencil, ChevronRight } from "lucide-react";
import { formatTerm } from "@/lib/terms";

export const dynamic = "force-dynamic";

export default async function AssignmentsPage() {
  const course = await getActiveCourse();

  if (!course) {
    return (
      <PageContainer>
        <Header title="Assignments" description="Pick a course to see its assignments" />
        <div className="text-center py-16 text-muted-foreground">
          <ClipboardList className="mx-auto h-12 w-12 mb-4 opacity-30" />
          <p className="text-lg font-medium mb-1">No active course</p>
          <p className="text-sm mb-4">Open a course from Courses and its assignments will show up here.</p>
          <LinkButton href="/courses">Go to Courses</LinkButton>
        </div>
      </PageContainer>
    );
  }

  const assignments = await getAssignmentsForCourse(course.id);

  return (
    <PageContainer>
      <Header
        breadcrumb={
          <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-2">
            <Link href="/courses" className="hover:text-foreground transition-colors">
              Courses
            </Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <Link href={`/courses/${course.id}`} className="hover:text-foreground transition-colors">
              {course.code}
            </Link>
          </nav>
        }
        title={`${course.name} — Assignments`}
        description={`${course.code}${course.section ? ` · Section ${course.section}` : ""} · ${formatTerm(course.year, course.term)}`}
        actions={
          <LinkButton href={`/assignments/new?courseId=${course.id}`}>
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
          <LinkButton href={`/assignments/new?courseId=${course.id}`}>Create your first assignment</LinkButton>
        </div>
      ) : (
        <div className="rounded-xl border divide-y divide-border overflow-hidden">
          {assignments.map((a) => (
            <AssignmentRow key={a.id} assignment={a} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

type AssignmentRow = Awaited<ReturnType<typeof getAssignmentsForCourse>>[number];

function AssignmentRow({ assignment: a }: { assignment: AssignmentRow }) {
  return (
    <div className="flex items-center gap-4 px-4 py-2.5 hover:bg-muted/40 transition-colors group">
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
    </div>
  );
}
