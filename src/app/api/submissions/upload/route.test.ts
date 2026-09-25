import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { db } from "@/db";
import { submissions } from "@/db/schema";
import { getSubmissionDir } from "@/lib/file-storage";

import { POST } from "./route";

// Large, obviously-fake ids so this never collides with a real row and the
// resulting storage path is one we can safely assert doesn't exist.
const FAKE_ASSIGNMENT_ID = 987654;
const FAKE_STUDENT_ID = 123456;

function uploadRequest() {
  const form = new FormData();
  form.append("file", new File(["hello"], "hello.png", { type: "image/png" }));
  const url = `http://localhost:3000/api/submissions/upload?assignmentId=${FAKE_ASSIGNMENT_ID}&studentId=${FAKE_STUDENT_ID}`;
  return new NextRequest(url, { method: "POST", body: form });
}

describe("POST /api/submissions/upload", () => {
  it("401s an unauthenticated request without writing anything to disk or the database", async () => {
    const res = await POST(uploadRequest());
    expect(res.status).toBe(401);

    expect(existsSync(getSubmissionDir(FAKE_ASSIGNMENT_ID, FAKE_STUDENT_ID))).toBe(false);

    const rows = await db.select().from(submissions);
    expect(rows.some((r) => r.assignmentId === FAKE_ASSIGNMENT_ID)).toBe(false);
  });
});
