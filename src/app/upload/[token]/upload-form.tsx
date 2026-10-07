"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/auth/auth-shell";
import { MAX_FILE_SIZE, acceptExtensionsFor } from "@/lib/constants";
import { uploadNameTaken } from "@/actions/upload-links";

interface Props {
  token: string;
  studentName: string | null;
  roster: { id: number; name: string }[];
  submissionType: string;
}

interface UploadResult {
  fileName: string;
  fileSize: number;
  time: Date;
  replaced: boolean;
  /** The student had a file by this name already and chose to keep it. */
  keptEarlier: boolean;
}

function normalizeSubmissionType(type: string): "image" | "video" | "any" {
  return type === "image" || type === "video" ? type : "any";
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb < 10 ? 1 : 0)}MB`;
}

/** Parses an XHR's response body only when the server actually said it's JSON — a 413/502 from a proxy in front of the app is usually plain text or HTML. */
function readJson(xhr: XMLHttpRequest): Record<string, unknown> | null {
  const contentType = xhr.getResponseHeader("content-type") || "";
  if (!contentType.includes("application/json")) return null;
  try {
    return JSON.parse(xhr.responseText);
  } catch {
    return null;
  }
}

function describeFailure(xhr: XMLHttpRequest): string {
  const data = readJson(xhr);
  if (data && typeof data.error === "string") return data.error;

  if (xhr.status === 413) return "That file is too large (max 500MB). Choose a smaller file.";
  if (xhr.status === 410 || xhr.status === 404) return "This upload link is no longer valid. Ask your instructor for a new link.";
  if (xhr.status >= 500) return "The server had a problem handling your upload. Please try again in a bit.";
  if (xhr.status === 0) return "Couldn't reach the server. Check your connection and try again.";
  return "Upload failed. Please try again.";
}

export function UploadForm({ token, studentName, roster, submissionType }: Props) {
  const [studentId, setStudentId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(false);
  // The chosen file's name is already taken — waiting on replace / keep both.
  const [clash, setClash] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const needsStudentPick = !studentName;

  const allowedExtensions = useMemo(() => acceptExtensionsFor(normalizeSubmissionType(submissionType)), [submissionType]);
  const acceptAttr = allowedExtensions.join(",");

  // Warn before leaving the tab while an upload is in flight — a phone
  // locking or a swipe-away mid-upload would otherwise silently drop it.
  useEffect(() => {
    if (!pending) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [pending]);

  function handleCancel() {
    xhrRef.current?.abort();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!file) return setError("Choose a file to upload.");
    if (file.size > MAX_FILE_SIZE) {
      return setError(`That file is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_FILE_SIZE)}. Choose a smaller file.`);
    }
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (allowedExtensions.length > 0 && !allowedExtensions.includes(ext)) {
      return setError(`That file type isn't accepted for this assignment. Allowed types: ${allowedExtensions.join(", ")}`);
    }
    if (needsStudentPick && !studentId) return setError("Select your name.");

    // Ask before anything is sent, so the answer costs one upload, not two.
    setChecking(true);
    let taken = false;
    try {
      taken = await uploadNameTaken(token, file.name, needsStudentPick ? Number(studentId) : null);
    } catch {
      // Unanswered, the server keeps both — nothing is lost by going ahead.
    } finally {
      setChecking(false);
    }
    if (taken) return setClash(true);

    await upload(file);
  }

  async function upload(uploadedFile: File, onNameClash?: "replace" | "add") {
    setClash(false);
    setError(null);

    const formData = new FormData();
    formData.append("file", uploadedFile);
    if (needsStudentPick) formData.append("studentId", studentId);
    if (onNameClash) formData.append("onNameClash", onNameClash);

    setPending(true);
    setProgress({ loaded: 0, total: uploadedFile.size });

    try {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;

      const outcome = await new Promise<{ ok: boolean; canceled: boolean }>((resolve) => {
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) setProgress({ loaded: ev.loaded, total: ev.total });
        };
        xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, canceled: false });
        xhr.onerror = () => resolve({ ok: false, canceled: false });
        xhr.onabort = () => resolve({ ok: false, canceled: true });
        xhr.open("POST", `/api/upload-links/${token}`);
        xhr.send(formData);
      });

      if (outcome.canceled) {
        // User-initiated; nothing to report.
        return;
      }

      if (!outcome.ok) {
        setError(describeFailure(xhr));
        return;
      }

      const data = readJson(xhr) as { submission?: { fileName?: string; fileSize?: number }; replaced?: boolean } | null;
      setResult({
        fileName: data?.submission?.fileName ?? uploadedFile.name,
        fileSize: data?.submission?.fileSize ?? uploadedFile.size,
        time: new Date(),
        replaced: Boolean(data?.replaced),
        keptEarlier: onNameClash === "add",
      });
      setFile(null);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      xhrRef.current = null;
      setPending(false);
      setProgress(null);
    }
  }

  if (result) {
    return (
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-foreground">
          Uploaded <span className="font-medium">{result.fileName}</span> ({formatBytes(result.fileSize)}) at{" "}
          {result.time.toLocaleTimeString()}.{result.replaced && " This replaced your earlier upload."}
          {result.keptEarlier && " Your earlier upload was kept as well."}
        </p>
        <Button variant="outline" className="h-12 w-full text-base" onClick={() => setResult(null)}>
          Upload another file
        </Button>
      </div>
    );
  }

  const percent = progress && progress.total > 0 ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {needsStudentPick && (
        <div className="space-y-2">
          <Label htmlFor="student">Your name</Label>
          <select
            id="student"
            required
            disabled={pending || checking}
            value={studentId}
            onChange={(e) => {
              setStudentId(e.target.value);
              setClash(false);
            }}
            className="h-11 w-full rounded-lg border border-border bg-input px-2.5 py-1 text-base outline-none focus-visible:border-primary/50 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40"
          >
            <option value="" disabled>
              Choose your name…
            </option>
            {roster.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="file">File</Label>
        <input
          id="file"
          type="file"
          required
          disabled={pending || checking}
          accept={acceptAttr}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setError(null);
            setClash(false);
          }}
          className="block w-full text-sm text-foreground file:mr-3 file:h-11 file:rounded-lg file:border file:border-border file:bg-secondary file:px-4 file:text-sm file:font-medium disabled:opacity-40"
        />
        <p className="text-xs text-muted-foreground">
          If you have already uploaded a file with the same name, you will be asked whether to replace it or keep both.
        </p>
      </div>

      {pending && progress && (
        <div className="space-y-2" role="status" aria-live="polite">
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-secondary"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-[linear-gradient(135deg,var(--primary),var(--primary-container))] transition-[width] duration-150"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Uploading… {percent}% ({formatBytes(progress.loaded)} of {formatBytes(progress.total)})
          </p>
        </div>
      )}

      <FormError>{error}</FormError>

      {clash && file ? (
        <div className="space-y-3 rounded-lg border border-border bg-muted p-4" role="group" aria-labelledby="clash-question">
          <p id="clash-question" className="text-sm leading-relaxed text-foreground" aria-live="polite">
            You have already uploaded a file named <span className="font-medium">{file.name}</span>. Replace it with this
            one, or keep both?
          </p>
          <div className="space-y-2">
            <Button type="button" className="h-12 w-full text-base" onClick={() => upload(file, "replace")}>
              Replace it
            </Button>
            <Button type="button" variant="outline" className="h-12 w-full text-base" onClick={() => upload(file, "add")}>
              Keep both
            </Button>
            <Button type="button" variant="ghost" className="h-11 w-full text-sm" onClick={() => setClash(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Button type="submit" className="h-12 w-full text-base" disabled={pending || checking}>
            {pending ? "Uploading…" : checking ? "Checking…" : "Upload"}
          </Button>
          {pending && (
            <Button type="button" variant="outline" className="h-12 w-full text-base" onClick={handleCancel}>
              Cancel
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
