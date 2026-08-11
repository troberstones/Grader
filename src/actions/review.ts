"use server";

import path from "path";
import { and, asc, eq, gt, isNull, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { reviewMedia, reviewPrefs, reviewStrokes, submissions } from "@/db/schema";
import { ingestFile } from "@grader/art-review/server";
import type { FrameMarker, ReviewItem } from "@grader/art-review";

/**
 * Server side of ReviewDataAdapter.
 *
 * Item ids are `sub:{submissionId}` so a stroke stays attached to a file even
 * if the playlist is reordered or the student uploads more work.
 */

export type StoredStrokeRow = {
  id: number;
  seq: number;
  localId: string;
  frameIn: number;
  frameOut: number;
  authorId: string;
  b: string;
  createdAt: string;
};

const REVIEW_DIR = "storage/review";

function itemIdFor(submissionId: number): string {
  return `sub:${submissionId}`;
}

export async function parseContext(contextId: string): Promise<{ assignmentId: number; studentId: number }> {
  const m = /^assignment:(\d+):student:(\d+)$/.exec(contextId);
  if (!m) throw new Error(`bad context id: ${contextId}`);
  return { assignmentId: Number(m[1]), studentId: Number(m[2]) };
}

// ── Ingest ────────────────────────────────────────────────────────────────────

// Module-level so two tabs opening the same student don't transcode twice.
const inFlight = new Map<number, Promise<void>>();

/**
 * Produce web-safe derivatives for a submission if they don't exist yet.
 *
 * Idempotent and cheap on the second call — the expensive work is guarded by
 * the presence of review_media rows, not by re-running ffmpeg.
 */
export async function ensureIngested(submissionId: number): Promise<void> {
  const existing = await db
    .select({ id: reviewMedia.id })
    .from(reviewMedia)
    .where(and(eq(reviewMedia.submissionId, submissionId), eq(reviewMedia.status, "ready")))
    .limit(1);
  if (existing.length > 0) return;

  const running = inFlight.get(submissionId);
  if (running) return running;

  const job = (async () => {
    const rows = await db.select().from(submissions).where(eq(submissions.id, submissionId));
    const sub = rows[0];
    if (!sub) return;

    const absolute = path.join(process.cwd(), sub.filePath);
    const outDir = path.join(process.cwd(), REVIEW_DIR, String(sub.assignmentId), String(sub.studentId));
    const baseName = `s${submissionId}`;

    try {
      const result = await ingestFile(absolute, sub.fileName, {
        outDir,
        baseName,
        maxWidth: 1920,
        allIntra: true,
      });

      const relative = (p: string) => path.relative(process.cwd(), p);

      if (result.derivatives.length === 0) {
        // PDFs render client-side, so there is nothing on disk to register —
        // but the item still needs a row to carry its page count.
        await db.insert(reviewMedia).values({
          submissionId,
          variant: "original",
          idx: 0,
          path: sub.filePath,
          mime: sub.fileType,
          kind: result.kind,
          width: result.width,
          height: result.height,
          frameCount: result.frameCount,
          fps: result.fps,
          duration: result.duration,
          status: "ready",
          warnings: result.warnings.join("; ") || null,
        });
      } else {
        for (const d of result.derivatives) {
          await db.insert(reviewMedia).values({
            submissionId,
            variant: d.variant,
            idx: d.idx,
            path: relative(d.path),
            mime: d.mime,
            kind: result.kind,
            width: d.width ?? result.width,
            height: d.height ?? result.height,
            frameCount: d.frameCount ?? result.frameCount,
            fps: d.fps ?? result.fps,
            duration: d.duration ?? result.duration,
            colorPrimaries: d.colorPrimaries,
            colorTransfer: d.colorTransfer,
            status: "ready",
            warnings: result.warnings.join("; ") || null,
          });
        }
      }

      // Backfill the columns the old review page reads, now that they are known
      // authoritatively rather than guessed by the browser after playback.
      if (result.fps || result.frameCount) {
        await db
          .update(submissions)
          .set({
            fps: result.fps ?? undefined,
            frameCount: result.frameCount ?? undefined,
            duration: result.duration ?? undefined,
          })
          .where(eq(submissions.id, submissionId));
      }
    } catch (e) {
      await db.insert(reviewMedia).values({
        submissionId,
        variant: "original",
        idx: 0,
        path: sub.filePath,
        mime: sub.fileType,
        kind: sub.mediaType === "video" ? "video" : "still",
        status: "failed",
        warnings: e instanceof Error ? e.message : String(e),
      });
    }
  })().finally(() => inFlight.delete(submissionId));

  inFlight.set(submissionId, job);
  return job;
}

// ── Playlist ──────────────────────────────────────────────────────────────────

export async function listReviewItems(contextId: string): Promise<ReviewItem[]> {
  const { assignmentId, studentId } = await parseContext(contextId);

  const subs = await db
    .select()
    .from(submissions)
    .where(and(eq(submissions.assignmentId, assignmentId), eq(submissions.studentId, studentId)))
    .orderBy(asc(submissions.id));

  await Promise.all(subs.map((s) => ensureIngested(s.id).catch(() => {})));

  const items: ReviewItem[] = [];
  for (const sub of subs) {
    const media = await db
      .select()
      .from(reviewMedia)
      .where(eq(reviewMedia.submissionId, sub.id))
      .orderBy(asc(reviewMedia.idx));

    const failed = media.find((m) => m.status === "failed");
    if (failed) {
      // Do not hand a file we already know is broken to the viewer as if it
      // were an image — it just fails again as "could not be decoded", which
      // says nothing about why. Carry the real reason instead.
      items.push({
        id: itemIdFor(sub.id),
        label: sub.fileName,
        kind: "still",
        mime: sub.fileType,
        url: "",
        width: 1600,
        height: 900,
        frameCount: 1,
        fps: null,
        duration: null,
        unavailable: failed.warnings ?? "This file could not be processed",
      });
      continue;
    }

    const proxy = media.find((m) => m.variant === "proxy");
    const composite = media.find((m) => m.variant === "composite");
    const manifest = media.find((m) => m.variant === "page" && m.idx === -1);
    const poster = media.find((m) => m.variant === "poster");
    const primary = proxy ?? composite ?? media.find((m) => m.variant === "original");

    const kind = (primary?.kind ?? (sub.mediaType === "video" ? "video" : "still")) as ReviewItem["kind"];
    const url = primary?.variant === "original" || !primary
      ? `/api/submissions/${sub.id}/file`
      : `/api/review/media/${primary.id}`;

    items.push({
      id: itemIdFor(sub.id),
      label: sub.fileName,
      kind: failed ? "still" : kind,
      mime: primary?.mime ?? sub.fileType,
      url,
      width: primary?.width ?? 1600,
      height: primary?.height ?? 900,
      frameCount: Math.max(1, primary?.frameCount ?? 1),
      fps: primary?.fps ?? null,
      duration: primary?.duration ?? null,
      posterUrl: poster ? `/api/review/media/${poster.id}` : undefined,
      layersUrl: manifest ? `/api/review/layers/${sub.id}` : undefined,
      allIntra: !!proxy,
      colorSpace: {
        primaries: primary?.colorPrimaries ?? undefined,
        transfer: primary?.colorTransfer ?? undefined,
      },
    });
  }

  return items;
}

// ── Strokes ───────────────────────────────────────────────────────────────────

export async function getStrokes(
  itemId: string,
  sinceSeq?: number,
): Promise<{ strokes: StoredStrokeRow[]; deleted: number[]; head: number }> {
  const base = and(
    eq(reviewStrokes.itemId, itemId),
    sinceSeq ? gt(reviewStrokes.seq, sinceSeq) : undefined,
  );

  const rows = await db
    .select()
    .from(reviewStrokes)
    .where(and(base, isNull(reviewStrokes.deletedAt)))
    .orderBy(asc(reviewStrokes.seq));

  const removed = sinceSeq
    ? await db
        .select({ id: reviewStrokes.id })
        .from(reviewStrokes)
        .where(and(eq(reviewStrokes.itemId, itemId), sql`${reviewStrokes.deletedAt} IS NOT NULL`))
    : [];

  const headRow = await db
    .select({ head: max(reviewStrokes.seq) })
    .from(reviewStrokes)
    .where(eq(reviewStrokes.itemId, itemId));

  return {
    strokes: rows.map((r) => ({
      id: r.id,
      seq: r.seq,
      localId: r.localId,
      frameIn: r.frameIn,
      frameOut: r.frameOut,
      authorId: r.authorId,
      b: Buffer.from(r.data as Buffer).toString("base64"),
      createdAt: r.createdAt,
    })),
    deleted: removed.map((r) => r.id),
    head: headRow[0]?.head ?? 0,
  };
}

export async function appendStrokes(
  itemId: string,
  strokes: { localId: string; frameIn: number; frameOut: number; authorId: string; b: string }[],
): Promise<StoredStrokeRow[]> {
  if (strokes.length === 0) return [];

  const headRow = await db
    .select({ head: max(reviewStrokes.seq) })
    .from(reviewStrokes)
    .where(eq(reviewStrokes.itemId, itemId));
  let seq = headRow[0]?.head ?? 0;

  const out: StoredStrokeRow[] = [];
  for (const s of strokes) {
    seq += 1;
    const data = Buffer.from(s.b, "base64");
    try {
      const inserted = await db
        .insert(reviewStrokes)
        .values({
          itemId,
          seq,
          localId: s.localId,
          frameIn: s.frameIn,
          frameOut: s.frameOut,
          authorId: s.authorId,
          data,
        })
        .returning();
      const row = inserted[0];
      out.push({
        id: row.id,
        seq: row.seq,
        localId: row.localId,
        frameIn: row.frameIn,
        frameOut: row.frameOut,
        authorId: row.authorId,
        b: s.b,
        createdAt: row.createdAt,
      });
    } catch {
      // Unique (item_id, local_id) — a retried save is not a new stroke.
      const existing = await db
        .select()
        .from(reviewStrokes)
        .where(and(eq(reviewStrokes.itemId, itemId), eq(reviewStrokes.localId, s.localId)));
      if (existing[0]) {
        out.push({
          id: existing[0].id,
          seq: existing[0].seq,
          localId: existing[0].localId,
          frameIn: existing[0].frameIn,
          frameOut: existing[0].frameOut,
          authorId: existing[0].authorId,
          b: s.b,
          createdAt: existing[0].createdAt,
        });
      }
      seq -= 1;
    }
  }
  return out;
}

/** Soft delete keeps `seq` monotonic, so every peer's sync cursor stays valid. */
export async function deleteStrokes(itemId: string, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  for (const id of ids) {
    await db
      .update(reviewStrokes)
      .set({ deletedAt: sql`(datetime('now'))` })
      .where(and(eq(reviewStrokes.id, id), eq(reviewStrokes.itemId, itemId)));
  }
}

/** Timeline ticks straight from the index — no stroke bodies decoded. */
export async function getMarkers(itemId: string): Promise<FrameMarker[]> {
  const rows = await db
    .select({
      frameIn: reviewStrokes.frameIn,
      frameOut: max(reviewStrokes.frameOut),
      count: sql<number>`count(*)`,
    })
    .from(reviewStrokes)
    .where(and(eq(reviewStrokes.itemId, itemId), isNull(reviewStrokes.deletedAt)))
    .groupBy(reviewStrokes.frameIn)
    .orderBy(asc(reviewStrokes.frameIn));

  return rows.map((r) => ({
    frameIn: r.frameIn,
    frameOut: r.frameOut ?? r.frameIn,
    count: Number(r.count),
  }));
}

// ── Preferences ───────────────────────────────────────────────────────────────

export async function savePrefs(contextId: string, prefs: Record<string, unknown>): Promise<void> {
  await db
    .insert(reviewPrefs)
    .values({ contextId, data: JSON.stringify(prefs) })
    .onConflictDoUpdate({
      target: reviewPrefs.contextId,
      set: { data: JSON.stringify(prefs), updatedAt: sql`(datetime('now'))` },
    });
}

export async function loadPrefs(contextId: string): Promise<Record<string, unknown> | null> {
  const rows = await db.select().from(reviewPrefs).where(eq(reviewPrefs.contextId, contextId));
  if (!rows[0]) return null;
  try {
    return JSON.parse(rows[0].data) as Record<string, unknown>;
  } catch {
    return null;
  }
}
