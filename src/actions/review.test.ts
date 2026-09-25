import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { assignments, courses, reviewMedia, students, submissions, users } from "@/db/schema";
import { createSession } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";

const ingestFile = vi.hoisted(() => vi.fn());
vi.mock("@grader/art-review/server", () => ({ ingestFile }));

import { ensureIngested, retryIngest } from "./review";

let seq = 0;

async function seed() {
  // Captured immediately — seed() runs concurrently in the concurrency-cap
  // test below, and reading the shared `seq` after an `await` would race
  // every other in-flight call's own increment of it.
  const mySeq = ++seq;
  const passwordHash = await hashPassword("adminpassword123");
  const [admin] = await db
    .insert(users)
    .values({ name: "Prof Admin", email: `prof-review${mySeq}@example.test`, passwordHash, globalRole: "admin", status: "active" })
    .returning();
  await createSession(admin.id, {});

  const [course] = await db.insert(courses).values({ name: "Lighting", code: `REV ${mySeq}`, year: 2026, term: "fall" }).returning();
  const [assignment] = await db
    .insert(assignments)
    .values({ courseId: course.id, name: "Studio Lighting", pointsPossible: 50 })
    .returning();
  const [student] = await db.insert(students).values({ name: "Lovelace, Ada", sortName: "Lovelace, Ada" }).returning();

  const [sub] = await db
    .insert(submissions)
    .values({
      assignmentId: assignment.id,
      studentId: student.id,
      filePath: `storage/submissions/${assignment.id}/${student.id}/a_${mySeq}.png`,
      fileName: `a_${mySeq}.png`,
      fileType: "image/png",
      mediaType: "image",
    })
    .returning();

  return { assignment, student, submission: sub };
}

const okResult = {
  kind: "still" as const,
  derivatives: [],
  width: 100,
  height: 100,
  frameCount: 1,
  fps: null,
  duration: null,
  warnings: [] as string[],
};

async function mediaFor(submissionId: number) {
  return db.select().from(reviewMedia).where(eq(reviewMedia.submissionId, submissionId));
}

beforeEach(() => {
  ingestFile.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ensureIngested", () => {
  it("inserts a ready row on success and nothing on a second call", async () => {
    ingestFile.mockResolvedValue(okResult);
    const { submission } = await seed();

    await ensureIngested(submission.id);
    let media = await mediaFor(submission.id);
    expect(media).toHaveLength(1);
    expect(media[0].status).toBe("ready");

    await ensureIngested(submission.id);
    expect(ingestFile).toHaveBeenCalledTimes(1); // "already ready" short-circuits before touching ffmpeg again
    media = await mediaFor(submission.id);
    expect(media).toHaveLength(1);
  });

  it("records a failed row on failure, and does not immediately retry (backoff)", async () => {
    ingestFile.mockRejectedValue(new Error("ffmpeg not found"));
    const { submission } = await seed();

    await ensureIngested(submission.id);
    let media = await mediaFor(submission.id);
    expect(media).toHaveLength(1);
    expect(media[0].status).toBe("failed");
    expect(media[0].warnings).toMatch(/ffmpeg not found/);

    // A second review-page open moments later must not re-run ffmpeg.
    await ensureIngested(submission.id);
    expect(ingestFile).toHaveBeenCalledTimes(1);
    media = await mediaFor(submission.id);
    expect(media).toHaveLength(1); // still exactly one failed row, not two
  });

  it("retries after the backoff window, replacing the failed row on success", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      ingestFile.mockRejectedValueOnce(new Error("disk full"));
      ingestFile.mockResolvedValueOnce(okResult);
      const { submission } = await seed();

      await ensureIngested(submission.id);
      expect((await mediaFor(submission.id))[0].status).toBe("failed");

      // Still inside the backoff window — no retry yet.
      vi.advanceTimersByTime(60_000);
      await ensureIngested(submission.id);
      expect(ingestFile).toHaveBeenCalledTimes(1);

      // Past the window — auto-retry runs, succeeds, and the failed row is gone.
      vi.advanceTimersByTime(5 * 60 * 1000);
      await ensureIngested(submission.id);
      expect(ingestFile).toHaveBeenCalledTimes(2);

      const media = await mediaFor(submission.id);
      expect(media.filter((m) => m.status === "failed")).toHaveLength(0);
      expect(media.filter((m) => m.status === "ready")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up auto-retrying after the attempt cap, but a manual retry still runs immediately", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      ingestFile.mockRejectedValue(new Error("still broken"));
      const { submission } = await seed();

      // Exhaust the auto-retry budget, advancing past the backoff window each time.
      for (let i = 0; i < 3; i++) {
        await ensureIngested(submission.id);
        vi.advanceTimersByTime(10 * 60 * 1000);
      }
      expect(ingestFile).toHaveBeenCalledTimes(3);

      // Budget exhausted — an ordinary open no longer re-runs ffmpeg even
      // though we're well past the backoff window.
      await ensureIngested(submission.id);
      expect(ingestFile).toHaveBeenCalledTimes(3);

      // The manual "Retry processing" path bypasses both limits.
      ingestFile.mockResolvedValueOnce(okResult);
      await retryIngest(submission.id);
      expect(ingestFile).toHaveBeenCalledTimes(4);
      const media = await mediaFor(submission.id);
      expect(media.filter((m) => m.status === "ready")).toHaveLength(1);
      expect(media.filter((m) => m.status === "failed")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps concurrent transcodes process-wide", async () => {
    let active = 0;
    let maxActive = 0;
    ingestFile.mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 30));
      active--;
      return okResult;
    });

    const seeds = await Promise.all([seed(), seed(), seed(), seed(), seed()]);
    await Promise.all(seeds.map((s) => ensureIngested(s.submission.id)));

    expect(ingestFile).toHaveBeenCalledTimes(5);
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});
