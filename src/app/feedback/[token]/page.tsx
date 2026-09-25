import { AuthShell } from "@/components/auth/auth-shell";
import { FeedbackRubric } from "@/components/feedback/feedback-rubric";
import { parseSqlTime } from "@/lib/feedback/format";
import { recordLinkView, resolveFeedbackLink } from "@/lib/feedback/links";
import { loadFeedbackModel } from "@/lib/feedback/model";
import { FeedbackReviewer } from "./feedback-reviewer";

export const dynamic = "force-dynamic";

/**
 * A student's own feedback, reached from the link in their feedback email —
 * no sign-in, since students have no accounts yet (docs/student-accounts-
 * plan.md). The token is the whole of the access: this student, this
 * assignment, read-only, until the end of the term.
 */
export default async function FeedbackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await resolveFeedbackLink(token);
  const model = link ? await loadFeedbackModel(link.assignmentId, link.studentId) : null;

  if (!link || !model) {
    return (
      <AuthShell
        title="This feedback link isn't valid"
        subtitle="It may have expired at the end of the semester, or been replaced by a newer email from your instructor."
      >
        <p className="text-sm leading-relaxed text-muted-foreground">
          Check your email for a more recent feedback message, or ask your instructor to resend it.
        </p>
      </AuthShell>
    );
  }

  await recordLinkView(link.id);
  const expires = parseSqlTime(link.expiresAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="flex min-h-full flex-col gap-4 p-4 lg:h-full lg:flex-row lg:overflow-hidden">
      <div className="flex min-h-[60dvh] flex-1 flex-col lg:min-h-0">
        <FeedbackReviewer token={token} />
      </div>

      <aside className="w-full shrink-0 space-y-5 lg:w-[420px] lg:overflow-y-auto">
        <header className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {model.course.code} · {model.course.name}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{model.assignment.name}</h1>
          <p className="text-sm text-muted-foreground">Feedback for {model.student.name}</p>
        </header>

        <div className="inline-flex flex-col items-center rounded-xl bg-primary/10 px-5 py-2 ring-1 ring-primary/40">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Grade</span>
          <span className="text-3xl font-bold">{model.letter ?? "—"}</span>
        </div>
        {model.status === "missing" && (
          <p className="text-sm text-muted-foreground">No submission was received for this assignment.</p>
        )}

        {model.criteria.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rubric</h2>
            <FeedbackRubric model={model} />
          </section>
        )}

        {model.feedback && (
          <section className="space-y-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Comments</h2>
            <p className="whitespace-pre-line rounded-lg bg-card p-3 text-sm leading-relaxed">{model.feedback}</p>
          </section>
        )}

        <p className="pb-4 text-xs text-muted-foreground">
          This page is just for you — please don&rsquo;t share the link. It works until {expires}.
        </p>
      </aside>
    </div>
  );
}
