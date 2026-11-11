import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { assignments, courses, students, submissions } from "@/db/schema";
import { fileSource, ingestForStudent, type IngestOutcome } from "./ingest";
import { readPending, removePending, stagePending } from "./pending";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(64).fill(0)]);
const EXR = Buffer.from([0x76, 0x2f, 0x31, 0x01, ...Array(64).fill(0)]);

let root: string;
let assignmentId: number;
let studentId: number;

beforeEach(async () => {
  // Storage paths hang off process.cwd(); point them at a scratch tree.
  root = mkdtempSync(path.join(tmpdir(), "ingest-test-"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
  const [course] = await db.insert(courses).values({ name: "Studio", code: "ART 1", year: 2026, term: "fall" }).returning();
  const [a] = await db.insert(assignments).values({ courseId: course.id, name: "Renders", pointsPossible: 100 }).returning();
  const [s] = await db.insert(students).values({ name: "Rose Gray", sortName: "Gray, Rose" }).returning();
  assignmentId = a.id;
  studentId = s.id;
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

function out(): IngestOutcome {
  return { imported: [], skipped: [], submissionIds: [] };
}

describe("ingestForStudent", () => {
  it("adds the extension a file is missing, from its bytes", async () => {
    const abs = path.join(root, "render");
    writeFileSync(abs, PNG);
    const o = out();
    await ingestForStudent(fileSource(abs, "render", PNG.length), { assignmentId, studentId, tmpDir: root, out: o });
    expect(o.imported).toEqual([{ studentId, fileName: "render.png" }]);
    const rows = await db.select().from(submissions).where(eq(submissions.assignmentId, assignmentId));
    expect(rows.map((r) => [r.fileName, r.fileType])).toEqual([["render.png", "image/png"]]);
  });

  it("skips a file whose bytes aren't anything review can show", async () => {
    const abs = path.join(root, "scene.blend");
    writeFileSync(abs, "BLENDER-v300 and then some bytes");
    const o = out();
    await ingestForStudent(fileSource(abs, "scene.blend", 32), { assignmentId, studentId, tmpDir: root, out: o });
    expect(o.imported).toEqual([]);
    expect(o.skipped).toEqual([{ fileName: "scene.blend", reason: "unsupported file type" }]);
  });

  it("unpacks a zip (and a zip inside it) into the student", async () => {
    const src = path.join(root, "src");
    mkdirSync(path.join(src, "a"), { recursive: true });
    mkdirSync(path.join(src, "b"), { recursive: true });
    writeFileSync(path.join(src, "a", "shot.png"), PNG);
    writeFileSync(path.join(src, "b", "shot.png"), PNG);
    writeFileSync(path.join(src, "beauty"), EXR);
    writeFileSync(path.join(src, "notes.txt"), "hello");
    execFileSync("zip", ["-qr", path.join(root, "inner.zip"), "beauty"], { cwd: src });
    execFileSync("zip", ["-qr", path.join(root, "outer.zip"), "a", "b", "notes.txt"], { cwd: src });
    execFileSync("zip", ["-qj", path.join(root, "outer.zip"), path.join(root, "inner.zip")]);

    const abs = path.join(root, "outer.zip");
    const o = out();
    await ingestForStudent(fileSource(abs, "renders.zip", statSync(abs).size), {
      assignmentId,
      studentId,
      tmpDir: root,
      out: o,
    });
    expect(o.imported.map((i) => i.fileName).sort()).toEqual(["a - shot.png", "b - shot.png", "beauty.exr"]);
    expect(o.skipped).toEqual([{ fileName: "renders.zip › notes.txt", reason: "unsupported file type" }]);
  });
});

describe("pending files", () => {
  it("stages, reads back, and removes", async () => {
    const token = await stagePending(assignmentId, "mystery.png", async (abs) => writeFileSync(abs, PNG));
    expect(await readPending(assignmentId, token)).toMatchObject({ name: "mystery.png", size: PNG.length });
    await removePending(assignmentId, token);
    expect(await readPending(assignmentId, token)).toBeNull();
  });

  it("rejects a token that isn't one it made", async () => {
    expect(await readPending(assignmentId, "../../etc")).toBeNull();
  });
});
