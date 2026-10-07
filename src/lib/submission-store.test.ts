import { describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { assignments, courses, students, submissions } from "@/db/schema";

import { storeSubmissionFile } from "./submission-store";

let seq = 0;

async function seed() {
  const mySeq = ++seq;
  const [course] = await db.insert(courses).values({ name: "Lighting", code: `STORE ${mySeq}`, year: 2026, term: "fall" }).returning();
  const [assignment] = await db
    .insert(assignments)
    .values({ courseId: course.id, name: "Studio Lighting", pointsPossible: 50 })
    .returning();
  const [student] = await db.insert(students).values({ name: "Lovelace, Ada", sortName: "Lovelace, Ada" }).returning();
  return { assignmentId: assignment.id, studentId: student.id };
}

// Nothing here needs the bytes — only which rows exist afterwards.
const write = async () => {};

async function namesFor(assignmentId: number) {
  const rows = await db
    .select({ fileName: submissions.fileName })
    .from(submissions)
    .where(eq(submissions.assignmentId, assignmentId))
    .orderBy(asc(submissions.id));
  return rows.map((r) => r.fileName);
}

describe("storeSubmissionFile", () => {
  it("replaces a same-named file by default, keeping its submission row", async () => {
    const target = await seed();
    const first = await storeSubmissionFile({ ...target, originalName: "render.png", size: 1, write });
    const second = await storeSubmissionFile({ ...target, originalName: "render.png", size: 2, write });

    expect(second).toBe(first);
    expect(await namesFor(target.assignmentId)).toEqual(["render.png"]);
  });

  it("keeps both when asked to add, numbering the newcomers", async () => {
    const target = await seed();
    const add = () => storeSubmissionFile({ ...target, originalName: "render.png", size: 1, onNameClash: "add", write });
    const ids = [await add(), await add(), await add()];

    expect(new Set(ids).size).toBe(3);
    expect(await namesFor(target.assignmentId)).toEqual(["render.png", "render (2).png", "render (3).png"]);
  });

  it("only counts the same student's files as a clash", async () => {
    const a = await seed();
    const b = await seed();
    await storeSubmissionFile({ ...a, originalName: "render.png", size: 1, onNameClash: "add", write });
    await storeSubmissionFile({ ...b, originalName: "render.png", size: 1, onNameClash: "add", write });

    expect(await namesFor(b.assignmentId)).toEqual(["render.png"]);
  });
});
