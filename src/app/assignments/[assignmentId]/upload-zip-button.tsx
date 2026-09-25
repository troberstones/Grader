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

/**
 * Imports an LMS "download all submissions" zip (e.g. a Learning Suite
 * Gradebook Bundled Download). Sent with XMLHttpRequest rather than fetch
 * because these zips are large and fetch can't report upload progress.
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
      <Button variant="outline" disabled={progress !== null} onClick={() => inputRef.current?.click()}>
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
            <FileList
              title={`No matching student (${result.unmatched.length})`}
              items={result.unmatched}
              hint="The net ID in these names isn't on this course's roster."
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
