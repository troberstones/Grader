"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileArchive } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { BatchUploadResult } from "@/app/api/assignments/[assignmentId]/batch-upload/route";
import type { BatchAssignResult } from "@/app/api/assignments/[assignmentId]/batch-upload/assign/route";

/**
 * Imports an LMS "download all submissions" zip (e.g. a Learning Suite
 * Gradebook Bundled Download). Sent with XMLHttpRequest rather than fetch
 * because these zips are large and fetch can't report upload progress.
 * Files the zip's names don't place on the roster are listed afterwards with
 * a student picker, and assigned one at a time.
 */
export function UploadZipButton({ assignmentId }: { assignmentId: number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<BatchUploadResult | null>(null);

  function handleFile(file: File) {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/assignments/${assignmentId}/batch-upload`);
    xhr.setRequestHeader("Content-Type", "application/zip");
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      setProgress(pct < 100 ? `Uploading ${pct}%` : "Unpacking…");
    };
    xhr.onload = () => {
      setProgress(null);
      let body: (BatchUploadResult & { error?: string }) | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 400 || !body || body.error) {
        toast.error(body?.error ?? `Import failed (${xhr.status}).`);
        return;
      }
      setResult(body);
      router.refresh();
    };
    xhr.onerror = () => {
      setProgress(null);
      toast.error("Upload failed — check the connection and try again.");
    };
    setProgress("Uploading 0%");
    xhr.send(file);
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) handleFile(file);
        }}
      />
      <Button variant="outline" size="sm" disabled={progress !== null} onClick={() => inputRef.current?.click()}>
        <FileArchive className="mr-2 h-4 w-4" />
        {progress ?? "Upload zip"}
      </Button>

      <Dialog open={result !== null} onOpenChange={(open) => !open && setResult(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Zip imported</DialogTitle>
            <DialogDescription>
              Read as a {result?.format}. Added {result?.imported.length ?? 0} file
              {result?.imported.length === 1 ? "" : "s"} for{" "}
              {new Set(result?.imported.map((i) => i.studentName)).size} students. Previews are generating in the
              background.
            </DialogDescription>
          </DialogHeader>

          {result && result.unmatched.length > 0 && (
            <UnmatchedFiles
              assignmentId={assignmentId}
              files={result.unmatched}
              roster={result.roster}
              onAssigned={() => router.refresh()}
            />
          )}
          {result && result.skipped.length > 0 && (
            <FileList
              title={`Skipped (${result.skipped.length})`}
              items={result.skipped.map((s) => `${s.fileName} — ${s.reason}`)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

type RowState =
  | { status: "waiting"; studentId: number | null }
  | { status: "assigning"; studentId: number }
  | { status: "done"; studentId: number; summary: string }
  | { status: "error"; studentId: number | null; message: string };

/**
 * Roster students whose first or last name appears in the file name — a file
 * that kept the student's name but lost (or never had) the net ID.
 */
function suggestionsFor(fileName: string, roster: BatchUploadResult["roster"]) {
  const haystack = fileName.toLowerCase();
  return roster.filter((s) =>
    s.name
      .toLowerCase()
      .split(/\s+/)
      .some((part) => part.length >= 3 && haystack.includes(part)),
  );
}

function UnmatchedFiles({
  assignmentId,
  files,
  roster,
  onAssigned,
}: {
  assignmentId: number;
  files: BatchUploadResult["unmatched"];
  roster: BatchUploadResult["roster"];
  onAssigned: () => void;
}) {
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      files.map((f) => {
        const suggested = suggestionsFor(f.fileName, roster);
        return [f.token, { status: "waiting", studentId: suggested.length === 1 ? suggested[0].studentId : null }];
      }),
    ),
  );
  const setRow = (token: string, row: RowState) => setRows((prev) => ({ ...prev, [token]: row }));

  async function assign(token: string, studentId: number) {
    setRow(token, { status: "assigning", studentId });
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/batch-upload/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, studentId }),
      });
      const body = (await res.json().catch(() => null)) as (BatchAssignResult & { error?: string }) | null;
      if (!res.ok || !body || body.error) {
        setRow(token, { status: "error", studentId, message: body?.error ?? `Failed (${res.status}).` });
        return;
      }
      const n = body.imported.length;
      const summary =
        n === 0
          ? `Nothing usable inside${body.skipped.length ? ` (${body.skipped.length} skipped)` : ""}`
          : `Added ${n} file${n === 1 ? "" : "s"} for ${body.studentName}` +
            (body.skipped.length ? `, ${body.skipped.length} skipped` : "");
      setRow(token, { status: "done", studentId, summary });
      onAssigned();
    } catch {
      setRow(token, { status: "error", studentId, message: "Network error — try again." });
    }
  }

  const ready = files.filter((f) => {
    const r = rows[f.token];
    return (r.status === "waiting" || r.status === "error") && r.studentId !== null;
  });
  const busy = files.some((f) => rows[f.token].status === "assigning");

  async function assignAll() {
    for (const f of ready) await assign(f.token, rows[f.token].studentId!);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">No matching student ({files.length})</p>
        {ready.length > 1 && (
          <Button size="sm" variant="outline" disabled={busy} onClick={assignAll}>
            Assign {ready.length} chosen
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Pick whose each file is. A zip is unpacked into that student.
      </p>
      <ul className="max-h-72 overflow-y-auto rounded-lg border border-border text-xs">
        {files.map((f) => {
          const row = rows[f.token];
          const suggested = suggestionsFor(f.fileName, roster);
          const suggestedIds = new Set(suggested.map((s) => s.studentId));
          const others = roster.filter((s) => !suggestedIds.has(s.studentId));
          return (
            <li key={f.token} className="space-y-1 border-b border-border px-3 py-2 last:border-b-0">
              <p className="break-all">{f.fileName}</p>
              {row.status === "done" ? (
                <p className="text-emerald-600">{row.summary}</p>
              ) : (
                <div className="flex items-center gap-2">
                  <select
                    value={row.studentId ?? ""}
                    disabled={row.status === "assigning"}
                    onChange={(e) =>
                      setRow(f.token, { status: "waiting", studentId: e.target.value ? Number(e.target.value) : null })
                    }
                    className="min-w-0 flex-1 rounded-md border border-border bg-input px-2 py-1 text-sm"
                  >
                    <option value="">— Choose student —</option>
                    {suggested.length > 0 && (
                      <optgroup label="Suggested">
                        {suggested.map((s) => (
                          <option key={s.studentId} value={s.studentId}>
                            {s.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="Roster">
                      {others.map((s) => (
                        <option key={s.studentId} value={s.studentId}>
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  <Button
                    size="sm"
                    disabled={row.studentId === null || row.status === "assigning"}
                    onClick={() => row.studentId !== null && assign(f.token, row.studentId)}
                  >
                    {row.status === "assigning" ? "Assigning…" : "Assign"}
                  </Button>
                </div>
              )}
              {row.status === "error" && <p className="text-destructive">{row.message}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FileList({ title, items, hint }: { title: string; items: string[]; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <ul className="max-h-40 overflow-y-auto rounded-lg border border-border text-xs">
        {items.map((item) => (
          <li key={item} className="border-b border-border px-3 py-1.5 last:border-b-0 break-all">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
