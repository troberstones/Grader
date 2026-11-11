import path from "path";
import fs from "fs/promises";
import { createReadStream, createWriteStream } from "fs";
import { randomUUID } from "crypto";
import type { Readable } from "stream";
import { pipeline } from "stream/promises";
import yauzl from "yauzl";

import { MAX_FILE_SIZE } from "@/lib/constants";
import { getMediaType } from "@/lib/file-storage";
import { storeSubmissionFile } from "@/lib/submission-store";
import { isJunkEntry } from "./index";
import { SNIFF_BYTES, sniffExtension } from "./sniff";

/**
 * Filing one file from a batch zip under a student — the part shared by the
 * zip upload and by assigning a file the upload couldn't place.
 *
 * Two things beyond "store it":
 * - A zip (a student who zipped their renders) is unpacked and each file
 *   inside is filed under the same student, recursively up to MAX_ZIP_DEPTH.
 * - A file whose extension review can't show (none at all, or a stray one
 *   like "render.final") is sniffed by its first bytes; if it's a PNG, JPEG,
 *   EXR, … it is stored with that extension added.
 */

/** A file to file: a zip entry, or a staged file on disk. `open` may be called more than once. */
export interface IngestSource {
  name: string;
  size: number;
  open: () => Promise<Readable>;
}

export interface IngestOutcome {
  imported: { studentId: number; fileName: string }[];
  skipped: { fileName: string; reason: string }[];
  submissionIds: number[];
}

const MAX_ZIP_DEPTH = 3;

/**
 * What `src` should be stored as: its name with a usable extension, and
 * whether it is a zip to unpack. Null if it's neither something review can
 * show nor a zip.
 */
export async function classifySource(src: IngestSource): Promise<{ fileName: string; isZip: boolean } | null> {
  const ext = path.extname(src.name).toLowerCase();
  if (ext === ".zip") return { fileName: src.name, isZip: true };
  if (getMediaType(src.name)) return { fileName: src.name, isZip: false };
  const sniffed = sniffExtension(await readHead(src));
  if (!sniffed) return null;
  return { fileName: src.name + sniffed, isZip: sniffed === ".zip" };
}

export async function ingestForStudent(
  src: IngestSource,
  ctx: { assignmentId: number; studentId: number; tmpDir: string; out: IngestOutcome; label?: string; depth?: number },
): Promise<void> {
  const label = ctx.label ?? src.name;
  const depth = ctx.depth ?? 0;
  const kind = await classifySource(src);
  if (!kind) {
    ctx.out.skipped.push({ fileName: label, reason: "unsupported file type" });
    return;
  }

  if (kind.isZip) {
    if (depth >= MAX_ZIP_DEPTH) {
      ctx.out.skipped.push({ fileName: label, reason: "zips nested too deep" });
      return;
    }
    await unpackZip(src, { ...ctx, label, depth });
    return;
  }

  if (src.size > MAX_FILE_SIZE) {
    ctx.out.skipped.push({ fileName: label, reason: "larger than 500MB" });
    return;
  }
  const id = await storeSubmissionFile({
    assignmentId: ctx.assignmentId,
    studentId: ctx.studentId,
    originalName: kind.fileName,
    size: src.size,
    write: async (abs) => pipeline(await src.open(), createWriteStream(abs)),
  });
  ctx.out.submissionIds.push(id);
  ctx.out.imported.push({ studentId: ctx.studentId, fileName: kind.fileName });
}

async function unpackZip(
  src: IngestSource,
  ctx: { assignmentId: number; studentId: number; tmpDir: string; out: IngestOutcome; label: string; depth: number },
): Promise<void> {
  // yauzl needs random access, so a zip inside a zip goes to disk first.
  const zipPath = path.join(ctx.tmpDir, `nested-${randomUUID()}.zip`);
  await pipeline(await src.open(), createWriteStream(zipPath));
  let zip: yauzl.ZipFile;
  try {
    zip = await openZip(zipPath);
  } catch {
    ctx.out.skipped.push({ fileName: ctx.label, reason: "not a readable zip" });
    await fs.rm(zipPath, { force: true });
    return;
  }
  try {
    const entries = (await listEntries(zip)).filter((e) => !isJunkEntry(e.fileName));
    // Inside a student's own zip, folders are just how they organized it, so
    // files go in by their own name — unless two share one ("a/render.png",
    // "b/render.png"), which would replace each other; those keep their path.
    const baseCount = new Map<string, number>();
    for (const e of entries) {
      const base = path.posix.basename(e.fileName);
      baseCount.set(base, (baseCount.get(base) ?? 0) + 1);
    }
    for (const entry of entries) {
      const base = path.posix.basename(entry.fileName);
      const name = baseCount.get(base)! > 1 ? entry.fileName.replaceAll("/", " - ") : base;
      const label = `${ctx.label} › ${entry.fileName}`;
      if (entry.isEncrypted()) {
        ctx.out.skipped.push({ fileName: label, reason: "encrypted" });
        continue;
      }
      await ingestForStudent(
        { name, size: entry.uncompressedSize, open: () => zip.openReadStreamPromise(entry) },
        { ...ctx, label, depth: ctx.depth + 1 },
      );
    }
  } finally {
    zip.close();
    await fs.rm(zipPath, { force: true });
  }
}

async function readHead(src: IngestSource): Promise<Buffer> {
  const stream = await src.open();
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
      length += (chunk as Buffer).length;
      if (length >= SNIFF_BYTES) break;
    }
  } finally {
    stream.destroy();
  }
  return Buffer.concat(chunks).subarray(0, SNIFF_BYTES);
}

/** A source for a file already on disk. */
export function fileSource(abs: string, name: string, size: number): IngestSource {
  return { name, size, open: async () => createReadStream(abs) };
}

export function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err) reject(new Error("That file isn't a readable zip."));
      else resolve(zip);
    });
  });
}

export function listEntries(zip: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: yauzl.Entry[] = [];
    zip.on("entry", (entry: yauzl.Entry) => {
      entries.push(entry);
      zip.readEntry();
    });
    zip.on("end", () => resolve(entries));
    zip.on("error", reject);
    zip.readEntry();
  });
}
