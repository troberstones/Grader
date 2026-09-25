import { asc, eq } from "drizzle-orm";
import type { ReviewItem } from "@grader/art-review";

import { db } from "@/db";
import { reviewMedia, submissions } from "@/db/schema";

/**
 * One student's submissions as the reviewer's playlist.
 *
 * Lives outside src/actions/review.ts because it does no authorization of its
 * own — anything exported from a "use server" file is callable from the
 * browser. Two callers, each authorizing first: listReviewItems (a signed-in
 * instructor) and the read-only feedback page (a student's link token).
 *
 * `feedbackToken`, when given, is appended to every media URL so the media
 * routes can authorize a link holder who has no session.
 */
export async function buildReviewItems(
  subs: (typeof submissions.$inferSelect)[],
  feedbackToken?: string,
): Promise<ReviewItem[]> {
  const q = feedbackToken ? `?ft=${encodeURIComponent(feedbackToken)}` : "";
  const items: ReviewItem[] = [];
  for (const sub of subs) {
    const media = await db
      .select()
      .from(reviewMedia)
      .where(eq(reviewMedia.submissionId, sub.id))
      .orderBy(asc(reviewMedia.idx));

    // A successful retry leaves this submission with ready rows; prefer
    // those over any failed row that's still sitting around (ensureIngested
    // clears failed rows when a retry starts, but this stays a defense for
    // any data written before that guard existed, or a race between the two).
    const hasReady = media.some((m) => m.status === "ready");
    const failed = hasReady ? undefined : media.find((m) => m.status === "failed");
    if (failed) {
      // Do not hand a file we already know is broken to the viewer as if it
      // were an image — it just fails again as "could not be decoded", which
      // says nothing about why. Carry the real reason instead.
      items.push({
        id: `sub:${sub.id}`,
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
    // Already ordered by idx above, so this is frame order.
    const frames = media.filter((m) => m.variant === "frame");
    const primary = proxy ?? composite ?? frames[0] ?? media.find((m) => m.variant === "original");

    const kind = (primary?.kind ?? (sub.mediaType === "video" ? "video" : "still")) as ReviewItem["kind"];
    const url = primary?.variant === "original" || !primary
      ? `/api/submissions/${sub.id}/file${q}`
      : `/api/review/media/${primary.id}${q}`;

    // A sequence addresses its frames individually; frameCount follows the
    // urls rather than the stored count, so a frame that failed to decode
    // cannot leave the transport seeking past the end of the list.
    const frameUrls = frames.length
      ? frames.map((f) => `/api/review/media/${f.id}${q}`)
      : undefined;

    items.push({
      id: `sub:${sub.id}`,
      label: sub.fileName,
      kind: failed ? "still" : kind,
      mime: primary?.mime ?? sub.fileType,
      url,
      width: primary?.width ?? 1600,
      height: primary?.height ?? 900,
      frameCount: Math.max(1, frameUrls?.length ?? primary?.frameCount ?? 1),
      frameUrls,
      fps: primary?.fps ?? null,
      duration: primary?.duration ?? null,
      posterUrl: poster ? `/api/review/media/${poster.id}${q}` : undefined,
      layersUrl: manifest ? `/api/review/layers/${sub.id}${q}` : undefined,
      allIntra: !!proxy,
      colorSpace: {
        primaries: primary?.colorPrimaries ?? undefined,
        transfer: primary?.colorTransfer ?? undefined,
      },
    });
  }

  return items;
}
