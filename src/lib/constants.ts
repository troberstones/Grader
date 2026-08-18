export const SUPPORTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/tiff",
  "image/bmp",
];

export const SUPPORTED_VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-msvideo",
];

/**
 * Every extension the review pipeline can ingest (see classify() in
 * packages/art-review/src/server/ingest.ts), not just the plain-image/video
 * subset the two arrays above cover — those stay as-is since they drive the
 * older review-v1 upload zone's stricter accept list.
 */
export const SUPPORTED_EXTENSIONS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".psd": "image/vnd.adobe.photoshop",
  ".psb": "image/vnd.adobe.photoshop",
  ".exr": "image/x-exr",
  ".dpx": "image/x-dpx",
  ".tga": "image/x-tga",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  ".m4v": "video/x-m4v",
  ".mpg": "video/mpeg",
  ".mpeg": "video/mpeg",
};

/** Frame extensions ingestSequence() will assemble into one playable sequence — matches FRAME_EXT in scripts/import-sequence.mjs. */
export const SEQUENCE_FRAME_EXTENSIONS = new Set([
  ".exr",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".tif",
  ".tiff",
  ".dpx",
  ".tga",
]);

export const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB, per file

/** 'image' also covers PDFs/PSDs/EXRs — submissions.mediaType only distinguishes image vs. video. */
export function classifyMediaType(fileNameOrExt: string): "image" | "video" | null {
  const ext = fileNameOrExt.slice(fileNameOrExt.lastIndexOf(".")).toLowerCase();
  const mime = SUPPORTED_EXTENSIONS[ext];
  if (!mime) return null;
  if (mime === "application/pdf") return "image";
  return mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : null;
}

/** Extensions (with leading dot) matching an assignment's declared submission type, for an <input accept> list. */
export function acceptExtensionsFor(submissionType: "image" | "video" | "any"): string[] {
  return Object.keys(SUPPORTED_EXTENSIONS).filter(
    (ext) => submissionType === "any" || classifyMediaType(ext) === submissionType
  );
}

export const DEFAULT_RUBRIC_LEVELS = [
  { level: 3, label: "Professional / Mastery" },
  { level: 2, label: "Good with Minor Flaws" },
  { level: 1, label: "Lacking Key Aspects" },
  { level: 0, label: "Little / No Effort" },
];

export const STORAGE_DIR = "storage";
export const SUBMISSIONS_DIR = "storage/submissions";
export const THUMBNAILS_DIR = "storage/thumbnails";
export const RUBRICS_DIR = "storage/rubrics";
export const EXPORTS_DIR = "storage/exports";
