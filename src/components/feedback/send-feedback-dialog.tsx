"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Eye, FlaskConical, Mail, MailWarning, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  getFeedbackRoster,
  previewFeedback,
  sendFeedbackToStudent,
  type FeedbackOptions,
  type FeedbackPreview,
  type FeedbackRoster,
  type FeedbackRosterRow,
  type SendOutcome,
} from "@/actions/feedback";
import { fullDateTime, shortDate } from "@/lib/feedback/format";
import type { LastSent } from "@/lib/feedback/history";
import { cn } from "@/lib/utils";

type Audience = "graded" | "select";

interface Props {
  assignmentId: number;
  /** "button" for a page header, "icon" for a compact row like the assignment list. */
  trigger?: "button" | "icon";
  /** Lets the grade sheet update its sidebar marks without a reload. */
  onSent?: (studentId: number, lastSent: LastSent) => void;
}

const SENDABLE = new Set(["graded", "missing"]);

/**
 * "Send feedback to students": pick what to send (rubric, annotated frames, a
 * link to view online) and who to send it to (everyone graded and not yet
 * emailed, or a hand-picked list), preview one, then send one student at a
 * time with progress. Server side is src/actions/feedback.ts.
 */
export function SendFeedbackDialog({ assignmentId, trigger = "button", onSent }: Props) {
  const [open, setOpen] = useState(false);
  const [roster, setRoster] = useState<FeedbackRoster | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [options, setOptions] = useState<FeedbackOptions>({ rubric: true, annotations: true, link: false });
  const [audience, setAudience] = useState<Audience>("graded");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<{ loading: boolean; studentId: number; data: FeedbackPreview | null } | null>(null);
  const [progress, setProgress] = useState<{ total: number; results: SendOutcome[]; running: boolean } | null>(null);

  function load() {
    setLoadError(null);
    getFeedbackRoster(assignmentId)
      .then(setRoster)
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Couldn't load the roster."));
  }

  useEffect(() => {
    if (open) load();
    else {
      setPreview(null);
      if (!progress?.running) setProgress(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const students = roster?.students ?? [];
  const eligible = (s: FeedbackRosterRow) => SENDABLE.has(s.status) && !!s.email;
  const dueStudents = students.filter((s) => s.due && !!s.email);

  const recipients = useMemo(
    () => (audience === "graded" ? dueStudents : students.filter((s) => selected.has(s.id) && eligible(s))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [audience, roster, selected],
  );

  const nothingChosen = !options.rubric && !options.annotations && !options.link;

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const selectable = students.filter(eligible);
  const selectAll = () => setSelected(new Set(selectable.map((s) => s.id)));
  const invert = () => setSelected((prev) => new Set(selectable.filter((s) => !prev.has(s.id)).map((s) => s.id)));
  const clear = () => setSelected(new Set());

  async function showPreview(studentId: number) {
    setPreview({ loading: true, studentId, data: null });
    try {
      const data = await previewFeedback(assignmentId, studentId, options);
      setPreview({ loading: false, studentId, data });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't build the preview.");
      setPreview(null);
    }
  }

  async function send() {
    if (recipients.length === 0 || nothingChosen) return;
    const queue = [...recipients];
    const results: SendOutcome[] = [];
    setProgress({ total: queue.length, results: [], running: true });
    for (const s of queue) {
      let outcome: SendOutcome;
      try {
        outcome = await sendFeedbackToStudent(assignmentId, s.id, { ...options, onlyIfDue: audience === "graded" });
      } catch (err) {
        outcome = { studentId: s.id, name: s.name, result: "failed", reason: err instanceof Error ? err.message : String(err) };
      }
      results.push(outcome);
      if (outcome.result === "sent") onSent?.(s.id, outcome.lastSent);
      setProgress({ total: queue.length, results: [...results], running: true });
    }
    setProgress({ total: queue.length, results, running: false });
    const sent = results.filter((r) => r.result === "sent").length;
    const failed = results.filter((r) => r.result === "failed").length;
    if (sent) toast.success(`Emailed feedback to ${sent} student${sent === 1 ? "" : "s"}${roster?.testMode ? " (test — sent to you)" : ""}.`);
    if (failed) toast.error(`${failed} email${failed === 1 ? "" : "s"} failed to send.`);
    load();
  }

  const previewTarget = recipients[0] ?? students.find(eligible) ?? null;

  return (
    <Dialog open={open} onOpenChange={(next) => (!progress?.running ? setOpen(next) : undefined)}>
      {trigger === "icon" ? (
        <DialogTrigger
          render={
            <button
              type="button"
              className="shrink-0 p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Send feedback to students"
            />
          }
        >
          <Mail className="h-3.5 w-3.5" />
        </DialogTrigger>
      ) : (
        <DialogTrigger render={<Button variant="outline" />}>
          <Mail className="mr-2 h-4 w-4" />
          Send feedback to students
        </DialogTrigger>
      )}

      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        {preview ? (
          <PreviewPane
            preview={preview}
            students={students}
            onBack={() => setPreview(null)}
            onPick={showPreview}
          />
        ) : progress ? (
          <ProgressPane progress={progress} testMode={!!roster?.testMode} onDone={() => setProgress(null)} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Send feedback to students</DialogTitle>
              <DialogDescription>
                Grades are shown as letters, never points. Each student gets only their own feedback.
              </DialogDescription>
            </DialogHeader>

            {loadError && <p className="text-sm text-destructive">{loadError}</p>}

            {roster?.mailProblem && (
              <div className="flex gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">
                <MailWarning className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  <strong className="font-semibold">Can&apos;t send mail.</strong> {roster.mailProblem}. Preview still works.
                </span>
              </div>
            )}

            {roster?.testMode && (
              <div className="flex gap-2 rounded-lg bg-yellow-500/10 px-3 py-2 text-xs leading-relaxed text-yellow-200">
                <FlaskConical className="h-4 w-4 shrink-0 text-yellow-400 mt-0.5" />
                <span>
                  <strong className="font-semibold">Test mode.</strong> Every email goes to you ({roster.senderEmail})
                  instead of the student, with their name in the subject. Test sends are tracked separately from real
                  ones. Set <code>FEEDBACK_EMAIL_STUDENTS=1</code> on the server to email students directly.
                </span>
              </div>
            )}

            <section className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">What to send</h3>
              <Choice
                checked={options.rubric}
                onChange={(v) => setOptions((o) => ({ ...o, rubric: v }))}
                label="Graded rubric"
                hint="Each criterion with the chosen level highlighted, letter grades, and your comments."
              />
              <Choice
                checked={options.annotations}
                onChange={(v) => setOptions((o) => ({ ...o, annotations: v }))}
                label="Annotated frames"
                hint="Every frame you drew on, as images in the email. Frames with only a stray dot are left out."
              />
              <Choice
                checked={options.link}
                disabled={!roster?.linkAvailable}
                onChange={(v) => setOptions((o) => ({ ...o, link: v }))}
                label="Link to view online"
                hint={
                  roster && !roster.linkAvailable
                    ? "Needs APP_BASE_URL set on the server, so the link points somewhere a student can reach."
                    : "A private link to their rubric and annotated work in the reviewer, read-only, until the end of the semester. Resending replaces the earlier link."
                }
              />
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Send to</h3>
              <div className="flex flex-wrap gap-2">
                <AudienceButton active={audience === "graded"} onClick={() => setAudience("graded")}>
                  Graded{roster ? ` — ${dueStudents.length} new or changed` : ""}
                </AudienceButton>
                <AudienceButton active={audience === "select"} onClick={() => setAudience("select")}>
                  Select students
                </AudienceButton>
              </div>
              <p className="text-xs text-muted-foreground">
                {audience === "graded"
                  ? "Everyone graded who hasn't been emailed yet, plus anyone whose grade changed since they were."
                  : "Only graded students with an email on file can be picked."}
              </p>

              {audience === "select" && (
                <div className="flex items-center gap-1.5">
                  <Button size="xs" variant="outline" onClick={selectAll}>All</Button>
                  <Button size="xs" variant="outline" onClick={invert}>Invert</Button>
                  <Button size="xs" variant="outline" onClick={clear}>Clear</Button>
                  <span className="ml-auto text-xs text-muted-foreground">{recipients.length} selected</span>
                </div>
              )}

              <StudentList
                roster={roster}
                audience={audience}
                selected={selected}
                onToggle={toggle}
                onPreview={showPreview}
              />
            </section>

            <div className="flex items-center justify-between gap-2 pt-1">
              <Button
                variant="ghost"
                disabled={!previewTarget || nothingChosen}
                onClick={() => previewTarget && showPreview(previewTarget.id)}
              >
                <Eye className="mr-1.5 h-4 w-4" />
                Preview
              </Button>
              <Button onClick={send} disabled={!roster || !!roster.mailProblem || recipients.length === 0 || nothingChosen}>
                <Send className="mr-1.5 h-4 w-4" />
                {roster?.testMode ? "Send test" : "Send"} to {recipients.length} student{recipients.length === 1 ? "" : "s"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Choice({
  checked,
  disabled,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className={cn("flex gap-2.5 rounded-lg px-2 py-1.5", disabled ? "opacity-50" : "cursor-pointer hover:bg-muted/50")}>
      <input
        type="checkbox"
        className="mt-0.5"
        checked={checked && !disabled}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground leading-relaxed">{hint}</span>
      </span>
    </label>
  );
}

function AudienceButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-3 py-1.5 text-sm transition-colors",
        active ? "border-primary bg-primary/10 font-medium" : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function StudentList({
  roster,
  audience,
  selected,
  onToggle,
  onPreview,
}: {
  roster: FeedbackRoster | null;
  audience: Audience;
  selected: Set<number>;
  onToggle: (id: number) => void;
  onPreview: (id: number) => void;
}) {
  if (!roster) return <p className="text-sm text-muted-foreground">Loading roster…</p>;
  if (roster.students.length === 0) return <p className="text-sm text-muted-foreground">No students enrolled.</p>;

  return (
    <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
      {roster.students.map((s) => {
        const canPick = SENDABLE.has(s.status) && !!s.email;
        const included = audience === "graded" ? s.due && !!s.email : selected.has(s.id) && canPick;
        return (
          <div
            key={s.id}
            className={cn(
              "group flex items-center gap-2 border-b border-border px-3 py-1.5 text-sm last:border-b-0",
              audience === "select" && canPick && "hover:bg-secondary/50",
              !included && audience === "graded" && "opacity-60",
            )}
          >
            <input
              type="checkbox"
              checked={included}
              disabled={audience === "graded" || !canPick}
              onChange={() => onToggle(s.id)}
              aria-label={`Send to ${s.sortName}`}
            />
            <button
              type="button"
              className="flex-1 min-w-0 truncate text-left"
              disabled={audience === "graded" || !canPick}
              onClick={() => onToggle(s.id)}
            >
              {s.sortName}
            </button>
            <StatusLabel row={s} />
            {SENDABLE.has(s.status) && (
              <button
                type="button"
                onClick={() => onPreview(s.id)}
                title={`Preview ${s.sortName}'s email`}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
              >
                <Eye className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** One line per student: grade state, then what has been emailed and whether the link was opened. */
function StatusLabel({ row }: { row: FeedbackRosterRow }) {
  const parts: React.ReactNode[] = [];

  if (!SENDABLE.has(row.status)) {
    parts.push(<span key="g" className="text-muted-foreground">{row.status === "in_progress" ? "in progress" : "not graded"}</span>);
  } else if (!row.email) {
    parts.push(<span key="e" className="text-destructive">no email</span>);
  }

  if (row.lastSent) {
    parts.push(
      row.changed ? (
        <span key="s" className="flex items-center gap-1 text-yellow-500" title={`Emailed ${fullDateTime(row.lastSent.sentAt)}; the grade has changed since`}>
          <MailWarning className="h-3 w-3" /> changed since {shortDate(row.lastSent.sentAt)}
        </span>
      ) : (
        <span key="s" className="flex items-center gap-1 text-muted-foreground" title={`Emailed ${fullDateTime(row.lastSent.sentAt)}`}>
          <Mail className="h-3 w-3" /> {row.lastSent.testMode ? "test sent" : "emailed"} {shortDate(row.lastSent.sentAt)}
        </span>
      ),
    );
  } else if (SENDABLE.has(row.status) && row.email) {
    parts.push(<span key="s" className="text-muted-foreground">not emailed</span>);
  }

  if (row.lastFailure) {
    parts.push(
      <span key="f" className="text-destructive" title={row.lastFailure.error ?? undefined}>
        failed {shortDate(row.lastFailure.sentAt)}
      </span>,
    );
  }

  if (row.link?.lastViewedAt) {
    parts.push(
      <span key="v" className="text-green-500" title={`Opened ${row.link.viewCount}× — last ${fullDateTime(row.link.lastViewedAt)}`}>
        viewed {shortDate(row.link.lastViewedAt)}
      </span>,
    );
  }

  return <span className="flex shrink-0 items-center gap-2 text-xs">{parts}</span>;
}

function PreviewPane({
  preview,
  students,
  onBack,
  onPick,
}: {
  preview: { loading: boolean; studentId: number; data: FeedbackPreview | null };
  students: FeedbackRosterRow[];
  onBack: () => void;
  onPick: (id: number) => void;
}) {
  const choices = students.filter((s) => SENDABLE.has(s.status));
  const d = preview.data;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 pr-8">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <select
          className="ml-auto rounded-md border border-border bg-input px-2 py-1 text-sm"
          value={preview.studentId}
          onChange={(e) => onPick(Number(e.target.value))}
        >
          {choices.map((s) => (
            <option key={s.id} value={s.id}>
              {s.sortName}
            </option>
          ))}
        </select>
      </div>
      {preview.loading || !d ? (
        <p className="py-16 text-center text-sm text-muted-foreground animate-pulse">Rendering annotated frames…</p>
      ) : (
        <>
          <div className="space-y-0.5 text-xs text-muted-foreground">
            <div><span className="text-foreground">To:</span> {d.to}</div>
            <div><span className="text-foreground">Subject:</span> {d.subject}</div>
            <div>
              {d.frameCount} frame{d.frameCount === 1 ? "" : "s"}
              {d.attachmentBytes > 0 &&
                ` · ${
                  d.attachmentBytes < 1024 * 1024
                    ? `${Math.max(1, Math.round(d.attachmentBytes / 1024))} KB`
                    : `${(d.attachmentBytes / 1024 / 1024).toFixed(1)} MB`
                } of images`}
              {d.dotOnlyFrames > 0 && ` · ${d.dotOnlyFrames} dot-only frame${d.dotOnlyFrames === 1 ? "" : "s"} left out`}
            </div>
            {d.warnings.map((w) => (
              <div key={w} className="text-yellow-500">{w}</div>
            ))}
          </div>
          <iframe
            title="Email preview"
            srcDoc={d.html}
            sandbox=""
            className="h-[60vh] w-full rounded-lg border border-border bg-white"
          />
        </>
      )}
    </div>
  );
}

function ProgressPane({
  progress,
  testMode,
  onDone,
}: {
  progress: { total: number; results: SendOutcome[]; running: boolean };
  testMode: boolean;
  onDone: () => void;
}) {
  const done = progress.results.length;
  const pct = progress.total ? Math.round((done / progress.total) * 100) : 100;
  const sent = progress.results.filter((r) => r.result === "sent");
  const skipped = progress.results.filter((r) => r.result === "skipped");
  const failed = progress.results.filter((r) => r.result === "failed");

  return (
    <div className="space-y-3">
      <DialogHeader>
        <DialogTitle>{progress.running ? "Sending feedback…" : "Feedback sent"}</DialogTitle>
        <DialogDescription>
          {progress.running
            ? `${done} of ${progress.total} — rendering frames takes a few seconds per student.`
            : `${sent.length} sent${testMode ? " to you (test mode)" : ""}, ${skipped.length} skipped, ${failed.length} failed.`}
        </DialogDescription>
      </DialogHeader>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-green-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="max-h-72 overflow-y-auto rounded-lg border border-border text-sm">
        {progress.results.map((r) => (
          <div key={r.studentId} className="flex items-center gap-2 border-b border-border px-3 py-1.5 last:border-b-0">
            <span className="flex-1 truncate">{r.name}</span>
            {r.result === "sent" ? (
              <span className="text-xs text-green-500" title={r.warnings.join("\n") || undefined}>
                sent{testMode ? ` (to ${r.to})` : ""}
                {r.warnings.length > 0 && " ⚠"}
              </span>
            ) : (
              <span className={cn("text-xs", r.result === "failed" ? "text-destructive" : "text-muted-foreground")}>
                {r.result}: {r.reason}
              </span>
            )}
          </div>
        ))}
      </div>
      {!progress.running && (
        <div className="flex justify-end">
          <Button variant="outline" onClick={onDone}>Done</Button>
        </div>
      )}
    </div>
  );
}
