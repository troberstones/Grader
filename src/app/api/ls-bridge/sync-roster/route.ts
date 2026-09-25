/**
 * POST /api/ls-bridge/sync-roster
 *
 * Same-origin only — content_grader.js calls this with a relative fetch from
 * the grader page itself, so the grader session cookie travels normally. See
 * docs/security.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { students, courseEnrollments, courses } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { apiRequireCapability } from "@/lib/auth/api";

interface LSStudent {
  netId: string;
  name: string;
  sortName: string;
  email: string | null;
  lmsStudentId: string;
  section: string | null;
}

export async function POST(request: NextRequest) {
  let body: {
    courseId: number;
    students: LSStudent[];
    lsCourseId?: string;
    subsessionID?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { courseId, students: lsStudents, lsCourseId } = body;

  if (!courseId || !Array.isArray(lsStudents)) {
    return NextResponse.json({ error: "courseId and students[] are required" }, { status: 400 });
  }

  const auth = await apiRequireCapability("course.edit", { kind: "course", courseId }, request);
  if (!auth.user) return auth.response;

  try {
    // Verify the open LS tab belongs to this grader course
    if (lsCourseId) {
      const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
      if (!course) {
        return NextResponse.json({ error: "Course not found" }, { status: 404 });
      }

      if (course.lmsCourseId && course.lmsCourseId !== lsCourseId) {
        return NextResponse.json(
          {
            error: `Wrong Learning Suite course open. This grader course is linked to LS course "${course.lmsCourseId}" but the open LS tab is for "${lsCourseId}". Switch to the correct LS course tab and try again.`,
            lmsCourseId: course.lmsCourseId,
            openedCourseId: lsCourseId,
          },
          { status: 409 }
        );
      }

      // Auto-link on first sync
      if (!course.lmsCourseId) {
        await db
          .update(courses)
          .set({ lmsCourseId: lsCourseId, updatedAt: new Date().toISOString() })
          .where(eq(courses.id, courseId));
      }
    }

    let imported = 0;
    let updated = 0;

    for (const ls of lsStudents) {
      if (!ls.netId && !ls.lmsStudentId) continue;

      // Look up existing student by netId (primary) or lmsStudentId (fallback)
      let existing = ls.netId
        ? await db.select().from(students).where(eq(students.netId, ls.netId))
        : [];

      if (!existing.length && ls.lmsStudentId) {
        existing = await db
          .select()
          .from(students)
          .where(eq(students.lmsStudentId, ls.lmsStudentId));
      }

      let studentId: number;

      if (existing.length > 0) {
        studentId = existing[0].id;
        await db
          .update(students)
          .set({
            name: ls.name,
            sortName: ls.sortName,
            email: ls.email,
            lmsStudentId: ls.lmsStudentId || existing[0].lmsStudentId,
          })
          .where(eq(students.id, studentId));
        updated++;
      } else {
        const result = await db
          .insert(students)
          .values({
            name: ls.name,
            sortName: ls.sortName,
            netId: ls.netId || null,
            email: ls.email,
            lmsStudentId: ls.lmsStudentId || null,
          })
          .returning();
        studentId = result[0].id;
        imported++;
      }

      // Enroll in course (ignore if already enrolled)
      const enrollment = await db
        .select()
        .from(courseEnrollments)
        .where(
          and(
            eq(courseEnrollments.courseId, courseId),
            eq(courseEnrollments.studentId, studentId)
          )
        );

      if (!enrollment.length) {
        await db.insert(courseEnrollments).values({ courseId, studentId });
      }
    }

    return NextResponse.json({ imported, updated });
  } catch (err) {
    console.error("[ls-bridge/sync-roster]", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
