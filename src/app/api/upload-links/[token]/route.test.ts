import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { asc, eq } from "drizzle-orm";
import fs from "fs/promises";
import path from "path";

import { db } from "@/db";
import { assignments, courses, students, submissions, uploadLinks } from "@/db/schema";
import { expiryFromNow, generateToken, hashToken, UPLOAD_LINK_TTL_MS } from "@/lib/auth/tokens";
import { MAX_FILE_SIZE } from "@/lib/constants";

import { POST } from "./route";

/**
 * A body whose stream throws the instant anything tries to read it. Used to
 * prove a code path never calls request.formData() (the only thing that
 * would read the body): if it did, this would surface as a 500 from the
 * route's catch block instead of the status the check under test returns.
 */
function unreadableBody(): ReadableStream {
  return new ReadableStream({
    pull() {
      throw new Error("body must not be read");
    },
  });
}

function postRequest(token: string, opts: { contentLength?: number } = {}) {
  const body = unreadableBody();
  const headers: Record<string, string> = { "content-type": "multipart/form-data; boundary=x" };
  if (opts.contentLength !== undefined) headers["content-length"] = String(opts.contentLength);

  const request = new NextRequest(
    `http://localhost:3000/api/upload-links/${token}`,
    {
      method: "POST",
      headers,
      body,
      // Node's fetch Request requires this when the body is a stream.
      duplex: "half",
    } as unknown as ConstructorParameters<typeof NextRequest>[1],
  );

  return POST(request, { params: Promise.resolve({ token }) });
}

describe("POST /api/upload-links/[token]", () => {
  it("413s an oversized Content-Length before reading the body or checking the token", async () => {
    const res = await postRequest("does-not-matter", { contentLength: MAX_FILE_SIZE * 3 });
    expect(res.status).toBe(413);
    const data = await res.json();
    expect(data.error).toMatch(/too large/i);
  });

  it("rejects an invalid token without reading the body", async () => {
    const res = await postRequest("this-token-does-not-exist", { contentLength: 1024 });
    expect([404, 410]).toContain(res.status);
    const data = await res.json();
    expect(data.error).toBeTruthy();
  });
});

describe("POST /api/upload-links/[token] — a file name the student has already used", () => {
  let seq = 0;
  const seeded: number[] = [];

  async function seedLink() {
    const mySeq = ++seq;
    const [course] = await db.insert(courses).values({ name: "Studio I", code: `UPL ${mySeq}`, year: 2026, term: "fall" }).returning();
    const [assignment] = await db.insert(assignments).values({ courseId: course.id, name: "Figure Study", pointsPossible: 100 }).returning();
    const [student] = await db.insert(students).values({ name: "Ada Lovelace", sortName: "Lovelace, Ada" }).returning();
    const token = generateToken();
    await db.insert(uploadLinks).values({
      assignmentId: assignment.id,
      studentId: student.id,
      tokenHash: hashToken(token),
      expiresAt: expiryFromNow(UPLOAD_LINK_TTL_MS),
    });
    seeded.push(assignment.id);
    return { token, assignmentId: assignment.id };
  }

  async function upload(token: string, contents: string, onNameClash?: string) {
    const form = new FormData();
    form.append("file", new File([contents], "render.png", { type: "image/png" }));
    if (onNameClash) form.append("onNameClash", onNameClash);
    const request = new NextRequest(`http://localhost:3000/api/upload-links/${token}`, { method: "POST", body: form });
    const res = await POST(request, { params: Promise.resolve({ token }) });
    return { status: res.status, body: await res.json() };
  }

  const rowsFor = (assignmentId: number) =>
    db.select().from(submissions).where(eq(submissions.assignmentId, assignmentId)).orderBy(asc(submissions.id));

  // The route writes real files under storage/. Remove exactly those, by the
  // path each row recorded — never the directory, which on a dev machine can
  // be a real assignment's with the same id.
  afterEach(async () => {
    for (const assignmentId of seeded.splice(0)) {
      for (const row of await rowsFor(assignmentId)) {
        await fs.unlink(path.join(process.cwd(), row.filePath)).catch(() => {});
      }
    }
  });

  it("keeps both when the form doesn't say what to do", async () => {
    const { token, assignmentId } = await seedLink();
    await upload(token, "first");
    const second = await upload(token, "second");

    expect(second.status).toBe(200);
    expect(second.body.replaced).toBe(false);
    expect((await rowsFor(assignmentId)).map((r) => r.fileName)).toEqual(["render.png", "render (2).png"]);
  });

  it("keeps both when asked to", async () => {
    const { token, assignmentId } = await seedLink();
    await upload(token, "first");
    await upload(token, "second", "add");

    expect((await rowsFor(assignmentId)).map((r) => r.fileName)).toEqual(["render.png", "render (2).png"]);
  });

  it("replaces the earlier file only when asked to", async () => {
    const { token, assignmentId } = await seedLink();
    const first = await upload(token, "first");
    const second = await upload(token, "second!", "replace");

    expect(second.body.replaced).toBe(true);
    expect(second.body.submission.id).toBe(first.body.submission.id);
    const rows = await rowsFor(assignmentId);
    expect(rows.map((r) => r.fileName)).toEqual(["render.png"]);
    expect(rows[0].fileSize).toBe("second!".length);
  });
});
