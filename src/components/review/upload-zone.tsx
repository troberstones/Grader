"use client";

import { useRef, useState } from "react";
import { UploadCloud, Film, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SUPPORTED_IMAGE_TYPES, SUPPORTED_VIDEO_TYPES } from "@/lib/constants";

interface UploadZoneProps {
  submissionType: "image" | "video" | "any";
  onUpload: (file: File) => void;
  uploading?: boolean;
  studentName?: string;
}

export function UploadZone({ submissionType, onUpload, uploading, studentName }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const acceptTypes =
    submissionType === "image"
      ? SUPPORTED_IMAGE_TYPES
      : submissionType === "video"
      ? SUPPORTED_VIDEO_TYPES
      : [...SUPPORTED_IMAGE_TYPES, ...SUPPORTED_VIDEO_TYPES];

  const acceptAttr = acceptTypes.join(",");

  const typeLabel =
    submissionType === "image"
      ? "image (PNG, JPG, WEBP)"
      : submissionType === "video"
      ? "video (MP4, MOV, WEBM)"
      : "image or video";

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!acceptTypes.includes(file.type)) {
      alert(`Unsupported file type. Please upload a ${typeLabel}.`);
      return;
    }
    onUpload(file);
  }

  return (
    <div
      className={cn(
        "flex-1 flex flex-col items-center justify-center gap-4 border-2 border-dashed rounded-lg m-6 transition-colors cursor-pointer",
        dragging ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/50",
        uploading && "pointer-events-none opacity-60"
      )}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={acceptAttr}
        onChange={(e) => handleFiles(e.target.files)}
      />

      {uploading ? (
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <UploadCloud className="h-10 w-10 animate-pulse" />
          <p className="text-sm">Uploading…</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-muted-foreground text-center px-8">
          <div className="flex gap-3">
            {submissionType !== "video" && <ImageIcon className="h-8 w-8 opacity-50" />}
            {submissionType !== "image" && <Film className="h-8 w-8 opacity-50" />}
          </div>
          <div>
            <p className="font-medium text-foreground">
              {studentName ? `Upload ${studentName}'s submission` : "Upload submission"}
            </p>
            <p className="text-sm mt-1">
              Drag and drop or click to select a {typeLabel}
            </p>
            <p className="text-xs mt-1 opacity-60">Max 500 MB</p>
          </div>
        </div>
      )}
    </div>
  );
}
