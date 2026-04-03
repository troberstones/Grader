/**
 * GET  /api/ls-bridge/course-link?courseId=N  — returns the stored lmsCourseId
 * DELETE /api/ls-bridge/course-link?courseId=N — clears the link (allows re-linking to a different LS course)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { courses } from "@/db/schema";
import { eq } from "drizzle-orm";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  const courseId = Number(new URL(request.url).searchParams.get("courseId"));
  if (!courseId) {
    return NextResponse.json({ error: "courseId required" }, { status: 400, headers: CORS_HEADERS });
  }
  const [course] = await db.select({ lmsCourseId: courses.lmsCourseId }).from(courses).where(eq(courses.id, courseId));
  return NextResponse.json({ lmsCourseId: course?.lmsCourseId ?? null }, { headers: CORS_HEADERS });
}

export async function DELETE(request: NextRequest) {
  const courseId = Number(new URL(request.url).searchParams.get("courseId"));
  if (!courseId) {
    return NextResponse.json({ error: "courseId required" }, { status: 400, headers: CORS_HEADERS });
  }
  await db.update(courses).set({ lmsCourseId: null, updatedAt: new Date().toISOString() }).where(eq(courses.id, courseId));
  return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
}
