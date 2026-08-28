"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/auth/auth-shell";

interface Props {
  token: string;
  studentName: string | null;
  roster: { id: number; name: string }[];
  submissionType: string;
}

const ACCEPT_BY_TYPE: Record<string, string> = {
  image: "image/*",
  video: "video/*",
};

export function UploadForm({ token, studentName, roster, submissionType }: Props) {
  const [studentId, setStudentId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const needsStudentPick = !studentName;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!file) return setError("Choose a file to upload.");
    if (needsStudentPick && !studentId) return setError("Select your name.");

    setPending(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (needsStudentPick) formData.append("studentId", studentId);

      const res = await fetch(`/api/upload-links/${token}`, { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Upload failed.");
        return;
      }

      setDone(true);
      setFile(null);
    } catch {
      setError("Upload failed. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-foreground">Your file was uploaded.</p>
        <Button variant="outline" className="w-full" onClick={() => setDone(false)}>
          Upload another file
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {needsStudentPick && (
        <div className="space-y-2">
          <Label htmlFor="student">Your name</Label>
          <select
            id="student"
            required
            disabled={pending}
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            className="h-8 w-full rounded-lg border border-border bg-input px-2.5 py-1 text-sm outline-none focus-visible:border-primary/50 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40"
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
          disabled={pending}
          accept={ACCEPT_BY_TYPE[submissionType]}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-foreground file:mr-3 file:h-8 file:rounded-lg file:border file:border-border file:bg-secondary file:px-3 file:text-sm file:font-medium disabled:opacity-40"
        />
        <p className="text-xs text-muted-foreground">Uploading again with the same file name replaces your earlier submission.</p>
      </div>

      <FormError>{error}</FormError>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Uploading…" : "Upload"}
      </Button>
    </form>
  );
}
