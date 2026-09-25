/**
 * GET  /api/ls-bridge/course-link?courseId=N  — returns the stored lmsCourseId
 * DELETE /api/ls-bridge/course-link?courseId=N — clears the link (allows re-linking to a different LS course)
 *
 * Same-origin only — content_grader.js calls this with a relative fetch from
 * the grader page itself, so the grader session cookie travels normally. See
 * docs/security.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { courses } from "@/db/schema";
import { eq } from "drizzle-orm";
import { apiRequireCapability } from "@/lib/auth/api";

export async function GET(request: NextRequest) {
  const courseId = Number(new URL(request.url).searchParams.get("courseId"));
  if (!courseId) {
    return NextResponse.json({ error: "courseId required" }, { status: 400 });
  }

  const auth = await apiRequireCapability("course.view", { kind: "course", courseId });
  if (!auth.user) return auth.response;

  const [course] = await db.select({ lmsCourseId: courses.lmsCourseId }).from(courses).where(eq(courses.id, courseId));
  return NextResponse.json({ lmsCourseId: course?.lmsCourseId ?? null });
}

export async function DELETE(request: NextRequest) {
  const courseId = Number(new URL(request.url).searchParams.get("courseId"));
  if (!courseId) {
    return NextResponse.json({ error: "courseId required" }, { status: 400 });
  }

  const auth = await apiRequireCapability("course.edit", { kind: "course", courseId }, request);
  if (!auth.user) return auth.response;

  await db.update(courses).set({ lmsCourseId: null, updatedAt: new Date().toISOString() }).where(eq(courses.id, courseId));
  return NextResponse.json({ ok: true });
}
