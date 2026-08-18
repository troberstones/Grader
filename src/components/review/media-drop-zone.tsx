"use client";

import { useRef, useState } from "react";
import { acceptExtensionsFor } from "@/lib/constants";
import { uploadFiles } from "@/lib/media-upload";

interface Props {
  assignmentId: number;
  studentId: number;
  studentName: string;
  submissionType: "image" | "video" | "any";
  /** Called once every dropped/picked file has been written and its row inserted. */
  onUploaded: () => void;
}

/** Flattens a drop, including whole folders, into a plain file list. */
async function readDroppedFiles(dt: DataTransfer): Promise<File[]> {
  const items = dt.items;
  if (!items || items.length === 0 || typeof items[0]?.webkitGetAsEntry !== "function") {
    return Array.from(dt.files);
  }
  const entries = Array.from(items)
    .map((item) => item.webkitGetAsEntry())
    .filter((e): e is FileSystemEntry => !!e);
  if (entries.length === 0) return Array.from(dt.files);

  const files: File[] = [];
  async function walk(entry: FileSystemEntry): Promise<void> {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject)
      );
      files.push(file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const readBatch = () => new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      for (let batch = await readBatch(); batch.length > 0; batch = await readBatch()) {
        for (const child of batch) await walk(child);
      }
    }
  }
  await Promise.all(entries.map(walk));
  return files;
}

export function MediaDropZone({ assignmentId, studentId, studentName, submissionType, onUploaded }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<"idle" | "uploading">("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);

  const accept = acceptExtensionsFor(submissionType).join(",");
  const typeLabel = submissionType === "image" ? "image" : submissionType === "video" ? "video" : "image or video";

  async function handleFiles(files: File[]) {
    if (files.length === 0) return;
    setError(null);
    setStatus("uploading");
    try {
      await uploadFiles(assignmentId, studentId, files, setProgress);
      onUploaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
      setStatus("idle");
    }
  }

  const uploading = status === "uploading";

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0e0e0e",
      }}
    >
      <div
        onClick={() => !uploading && fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!uploading) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setDragging(false);
          if (uploading) return;
          handleFiles(await readDroppedFiles(e.dataTransfer));
        }}
        style={{
          width: 420,
          maxWidth: "80vw",
          padding: "40px 32px",
          borderRadius: 12,
          textAlign: "center",
          cursor: uploading ? "default" : "pointer",
          border: `2px dashed ${dragging ? "#e8843a" : "#3a3a3a"}`,
          background: dragging ? "rgba(232,132,58,0.08)" : "transparent",
          transition: "border-color 120ms, background 120ms",
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={accept}
          style={{ display: "none" }}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            handleFiles(files);
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          // @ts-expect-error non-standard but broadly supported attribute for folder selection
          webkitdirectory=""
          style={{ display: "none" }}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            handleFiles(files);
          }}
        />

        {uploading ? (
          <p style={{ color: "#adaaaa", fontSize: 14 }}>{progress}</p>
        ) : (
          <>
            <p style={{ color: "#e8e6e6", fontSize: 15, fontWeight: 500, marginBottom: 6 }}>
              No submissions for {studentName}
            </p>
            <p style={{ color: "#adaaaa", fontSize: 13, lineHeight: 1.5 }}>
              Drag and drop {typeLabel} artwork here, or a folder of numbered frames for a sequence.
            </p>
            <p style={{ color: "#7a7777", fontSize: 12, marginTop: 10 }}>
              Click to browse files, or{" "}
              <span
                style={{ color: "#e8843a", textDecoration: "underline" }}
                onClick={(e) => {
                  e.stopPropagation();
                  folderInputRef.current?.click();
                }}
              >
                choose a folder
              </span>
              .
            </p>
          </>
        )}

        {error && (
          <p style={{ color: "#fca5a5", fontSize: 13, marginTop: 14 }}>{error}</p>
        )}
      </div>
    </div>
  );
}
