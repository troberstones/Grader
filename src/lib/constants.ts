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

export const SUPPORTED_EXTENSIONS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
};

export const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB

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
