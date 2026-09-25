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
import { can } from "@/lib/auth/roles";
import { resolveAuthContext } from "@/lib/auth/course-context";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Whether `user` has course.edit on every course a student is currently
 * enrolled in — see the identical helper in src/actions/students.ts for why
 * this matters: a student matched by netId/lmsStudentId here may belong to
 * another instructor's course, and this sync must not let that course's
 * roster overwrite that student's name/email.
 */
async function callerMayEditAllEnrolledCourses(user: SessionUser, studentId: number): Promise<boolean> {
  const enrollments = await db
    .select({ courseId: courseEnrollments.courseId })
    .from(courseEnrollments)
    .where(eq(courseEnrollments.studentId, studentId));

  for (const { courseId } of enrollments) {
    const resource = { kind: "course" as const, courseId };
    const ctx = await resolveAuthContext(resource, user.id);
    if (!can(user, "course.edit", resource, ctx)) return false;
  }
  return true;
}

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
    let keptExisting = 0;

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
        if (await callerMayEditAllEnrolledCourses(auth.user, studentId)) {
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
          keptExisting++;
        }
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

    return NextResponse.json({ imported, updated, keptExisting });
  } catch (err) {
    console.error("[ls-bridge/sync-roster]", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
