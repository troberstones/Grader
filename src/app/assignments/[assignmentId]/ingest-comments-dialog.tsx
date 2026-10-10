"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { MessageSquareText, Copy, FileJson } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useGrading } from "@/components/shared/grading-context";
import { getStudentsForCourse } from "@/actions/students";
import { importFeedback } from "@/actions/grades";
import {
  buildIngestPrompt,
  parseIngestFile,
  matchSegments,
  type MatchedSegment,
  type RosterEntry,
} from "@/lib/feedback/comment-ingest";

type Row = MatchedSegment & { include: boolean };

/**
 * Turns a critique transcript into per-student written feedback: copy a
 * prompt (with the roster baked in) into an LLM along with the transcript,
 * then paste or upload the JSON it returns, confirm the matches, and apply.
 * See src/lib/feedback/comment-ingest.ts.
 */
export function IngestCommentsDialog({
  assignmentId,
  assignmentName,
  courseId,
}: {
  assignmentId: number;
  assignmentName: string;
  courseId: number;
}) {
  const { updateStudentGrade } = useGrading();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [json, setJson] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [mode, setMode] = useState<"append" | "replace">("append");
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (open && roster === null) getStudentsForCourse(courseId).then(setRoster);
  }, [open, courseId, roster]);

  const prompt = useMemo(() => (roster ? buildIngestPrompt(assignmentName, roster) : ""), [assignmentName, roster]);
  const byId = useMemo(() => new Map((roster ?? []).map((s) => [s.id, s])), [roster]);

  function reset() {
    setJson("");
    setRows(null);
  }

  function copyPrompt() {
    navigator.clipboard.writeText(prompt);
    toast.success("Prompt copied — paste it into Claude, then paste the transcript at the end.");
  }

  function load(text: string) {
    if (!roster) return;
    try {
      const matched = matchSegments(parseIngestFile(text), roster);
      setRows(matched.map((m) => ({ ...m, include: m.studentId !== null })));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't read that file.");
    }
  }

  function update(i: number, patch: Partial<Row>) {
    setRows((prev) => prev && prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  const chosen = rows?.filter((r) => r.include && r.studentId !== null) ?? [];
  const dupes = new Set(
    chosen.map((r) => r.studentId).filter((id, i, all) => all.indexOf(id) !== i),
  );

  async function apply() {
    // Two segments for the same student (e.g. a follow-up later in the
    // critique) are combined rather than one overwriting the other.
    const merged = new Map<number, string[]>();
    for (const r of chosen) merged.set(r.studentId!, [...(merged.get(r.studentId!) ?? []), r.summary]);
    const items = [...merged].map(([studentId, texts]) => ({ studentId, text: texts.join("\n\n") }));

    setApplying(true);
    try {
      const result = await importFeedback(assignmentId, items, mode);
      if (!result.success) {
        toast.error("Your session expired — sign in again and retry.");
        return;
      }
      for (const { studentId, grade } of result.grades) updateStudentGrade(studentId, grade);
      toast.success(`Feedback added for ${result.grades.length} student${result.grades.length === 1 ? "" : "s"}.`);
      setOpen(false);
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <MessageSquareText className="mr-2 h-4 w-4" />
        Ingest comments
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ingest critique comments</DialogTitle>
          <DialogDescription>
            Turn a critique transcript into written feedback for each student.
          </DialogDescription>
        </DialogHeader>

        {!rows ? (
          <div className="space-y-5">
            <section className="space-y-2">
              <p className="text-sm font-medium">1. Copy the matching prompt</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                It includes this course&apos;s roster ({roster?.length ?? "…"} students with net IDs). Paste it into
                Claude, add your transcript at the end, and it will answer with JSON matching each critique to a
                student.
              </p>
              <Textarea readOnly value={roster ? prompt : "Loading roster…"} className="h-40 font-mono text-xs field-sizing-fixed" />
              <Button variant="outline" size="sm" onClick={copyPrompt} disabled={!roster}>
                <Copy className="mr-2 h-3.5 w-3.5" />
                Copy prompt
              </Button>
            </section>

            <section className="space-y-2">
              <p className="text-sm font-medium">2. Paste or upload the JSON it returns</p>
              <Textarea
                value={json}
                onChange={(e) => setJson(e.target.value)}
                placeholder='{ "segments": [ … ] }'
                className="h-32 font-mono text-xs field-sizing-fixed"
              />
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json,.txt,text/plain"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) load(await file.text());
                }}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => load(json)} disabled={!json.trim() || !roster}>
                  Match students
                </Button>
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={!roster}>
                  <FileJson className="mr-2 h-3.5 w-3.5" />
                  Choose file
                </Button>
              </div>
            </section>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Check each match. Probable and unmatched segments are highlighted — pick the right student before
              including them.
            </p>
            <div className="rounded-lg border border-border divide-y divide-border">
              {rows.map((r, i) => {
                const candidates = r.candidateIds.map((id) => byId.get(id)).filter((s) => s !== undefined);
                const others = (roster ?? []).filter((s) => !r.candidateIds.includes(s.id));
                return (
                  <div
                    key={i}
                    className={`flex gap-3 px-3 py-2.5 text-sm ${r.match_status !== "exact" || r.studentId === null ? "bg-amber-500/5" : ""}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={r.include}
                      disabled={r.studentId === null}
                      onChange={(e) => update(i, { include: e.target.checked })}
                    />
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={r.studentId ?? ""}
                          onChange={(e) => {
                            const id = e.target.value ? Number(e.target.value) : null;
                            update(i, { studentId: id, include: id !== null });
                          }}
                          className="rounded-md border border-border bg-input px-2 py-1 text-sm"
                        >
                          <option value="">— Choose student —</option>
                          {candidates.length > 0 && (
                            <optgroup label="Suggested">
                              {candidates.map((s) => (
                                <option key={s.id} value={s.id}>{s.sortName}</option>
                              ))}
                            </optgroup>
                          )}
                          <optgroup label="Roster">
                            {others.map((s) => (
                              <option key={s.id} value={s.id}>{s.sortName}</option>
                            ))}
                          </optgroup>
                        </select>
                        <StatusBadge status={r.studentId === null ? "unmatched" : r.match_status} />
                        {r.studentId !== null && r.include && dupes.has(r.studentId) && (
                          <span className="text-xs text-amber-600">combined with another segment</span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {r.timestamp && <>{r.timestamp} · </>}
                          heard “{r.transcript_name ?? "no name"}”
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{r.summary}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={mode === "append"} onChange={() => setMode("append")} />
                Append to existing feedback
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} />
                Replace existing feedback
              </label>
            </div>
          </div>
        )}

        {rows && (
          <DialogFooter>
            <Button variant="outline" onClick={reset} disabled={applying}>
              Back
            </Button>
            <Button onClick={apply} disabled={applying || chosen.length === 0}>
              {applying ? "Saving…" : `Add feedback for ${new Set(chosen.map((r) => r.studentId)).size} students`}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ status }: { status: "exact" | "probable" | "unmatched" }) {
  const cls =
    status === "exact"
      ? "bg-emerald-500/10 text-emerald-600"
      : status === "probable"
        ? "bg-amber-500/10 text-amber-600"
        : "bg-destructive/10 text-destructive";
  return <span className={`rounded px-1.5 py-0.5 text-xs ${cls}`}>{status}</span>;
}
