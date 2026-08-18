import { notFound } from "next/navigation";
import Link from "next/link";
import { getStudentArchive } from "@/actions/archive";
import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { Badge } from "@/components/ui/badge";
import { Calendar, FileText, MessageSquare } from "lucide-react";
import { formatTerm } from "@/lib/terms";

const STATUS_LABELS: Record<string, string> = {
  ungraded: "Ungraded",
  in_progress: "In progress",
  graded: "Graded",
};

export default async function StudentArchivePage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  const archive = await getStudentArchive(Number(studentId));
  if (!archive) notFound();

  const { student, courses } = archive;

  return (
    <PageContainer>
      <Header
        breadcrumb={
          <Link href="/archive" className="text-sm text-muted-foreground hover:text-foreground mb-1 block">
            ← Archive
          </Link>
        }
        title={student.name}
        description={[student.netId, student.email].filter(Boolean).join(" · ") || undefined}
      />

      {courses.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>Not enrolled in any course.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {courses.map((course) => (
            <div key={course.id}>
              <h3 className="text-lg font-semibold mb-1">{course.name}</h3>
              <p className="text-sm text-muted-foreground mb-3">
                {course.code} · {formatTerm(course.year, course.term)}
              </p>

              {course.assignments.length === 0 ? (
                <p className="text-sm text-muted-foreground border rounded-lg py-6 text-center">No assignments.</p>
              ) : (
                <div className="rounded-xl border divide-y divide-border overflow-hidden">
                  {course.assignments.map((a) => (
                    <div key={a.id} className="flex items-center gap-4 px-4 py-2.5">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{a.name}</span>
                          {a.grade && (
                            <Badge variant={a.grade.status === "graded" ? "default" : "secondary"} className="text-xs">
                              {STATUS_LABELS[a.grade.status] ?? a.grade.status}
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
                          <span className="flex items-center gap-1">
                            <FileText className="h-3 w-3" />
                            {a.submissionCount} submission{a.submissionCount === 1 ? "" : "s"}
                          </span>
                          {a.annotationCount > 0 && (
                            <span className="flex items-center gap-1">
                              <MessageSquare className="h-3 w-3" />
                              {a.annotationCount} annotation{a.annotationCount === 1 ? "" : "s"}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {a.grade?.totalScore != null ? (
                          <span className="font-medium">
                            {a.grade.totalScore} / {a.pointsPossible}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">{a.pointsPossible} pts</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
