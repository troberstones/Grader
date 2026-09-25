import { describe, expect, it } from "vitest";

import { db } from "@/db";
import { assignments, courses, reviewMedia, students, submissions } from "@/db/schema";
import { buildReviewItems } from "./review-items";

let seq = 0;

async function seedSubmission() {
  seq++;
  const [course] = await db.insert(courses).values({ name: "Lighting", code: `RI ${seq}`, year: 2026, term: "fall" }).returning();
  const [assignment] = await db.insert(assignments).values({ courseId: course.id, name: "Studio", pointsPossible: 50 }).returning();
  const [student] = await db.insert(students).values({ name: "Turing, Alan", sortName: "Turing, Alan" }).returning();
  const [sub] = await db
    .insert(submissions)
    .values({
      assignmentId: assignment.id,
      studentId: student.id,
      filePath: `storage/submissions/${assignment.id}/${student.id}/f_${seq}.mp4`,
      fileName: `f_${seq}.mp4`,
      fileType: "video/mp4",
      mediaType: "video",
    })
    .returning();
  return sub;
}

describe("buildReviewItems", () => {
  it("shows the failure placeholder when only a failed row exists", async () => {
    const sub = await seedSubmission();
    await db.insert(reviewMedia).values({
      submissionId: sub.id,
      variant: "original",
      idx: 0,
      path: sub.filePath,
      mime: sub.fileType,
      kind: "video",
      status: "failed",
      warnings: "ffmpeg exited 1",
    });

    const [item] = await buildReviewItems([sub]);
    expect(item.unavailable).toBe("ffmpeg exited 1");
  });

  it("prefers a ready row over a stale failed row left from an earlier attempt", async () => {
    const sub = await seedSubmission();
    // Simulates data written before ensureIngested() started clearing failed
    // rows on retry: a failed row and a ready row coexisting for one submission.
    await db.insert(reviewMedia).values({
      submissionId: sub.id,
      variant: "original",
      idx: 0,
      path: sub.filePath,
      mime: sub.fileType,
      kind: "video",
      status: "failed",
      warnings: "ffmpeg exited 1",
    });
    await db.insert(reviewMedia).values({
      submissionId: sub.id,
      variant: "proxy",
      idx: 0,
      path: `storage/review/proxy_${sub.id}.mp4`,
      mime: "video/mp4",
      kind: "video",
      width: 1280,
      height: 720,
      status: "ready",
    });

    const [item] = await buildReviewItems([sub]);
    expect(item.unavailable).toBeUndefined();
    expect(item.kind).toBe("video");
    expect(item.url).toMatch(/\/api\/review\/media\//);
  });
});
