import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { assignments, courses } from "@/db/schema";
import { eq, and } from "drizzle-orm";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

interface LSAssignment {
  lmsAssignmentId: string;
  lmsGradebookId: string;
  name: string;
  points: number;
  dueDate: string | null;
  hasOnlineSubmission: boolean;
  type: string;
}

export async function POST(request: NextRequest) {
  try {
    const {
      courseId,
      assignments: lsAssignments,
      gradebookID,
      lsCourseId,
    } = (await request.json()) as {
      courseId: number;
      assignments: LSAssignment[];
      gradebookID: string;
      lsCourseId?: string;
    };

    if (!courseId || !Array.isArray(lsAssignments)) {
      return NextResponse.json(
        { error: "courseId and assignments[] are required" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Verify / auto-link the LS course
    if (lsCourseId) {
      const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
      if (!course) {
        return NextResponse.json({ error: "Course not found" }, { status: 404, headers: CORS_HEADERS });
      }

      if (course.lmsCourseId && course.lmsCourseId !== lsCourseId) {
        return NextResponse.json(
          {
            error: `Wrong Learning Suite course open. Expected "${course.lmsCourseId}" but got "${lsCourseId}". Switch to the correct LS course tab and try again.`,
            lmsCourseId: course.lmsCourseId,
            openedCourseId: lsCourseId,
          },
          { status: 409, headers: CORS_HEADERS }
        );
      }

      if (!course.lmsCourseId) {
        await db
          .update(courses)
          .set({ lmsCourseId: lsCourseId, updatedAt: new Date().toISOString() })
          .where(eq(courses.id, courseId));
      }
    }

    let added = 0;
    let updated = 0;
    const synced: { id: number; lmsAssignmentId: string; name: string }[] = [];

    for (const ls of lsAssignments) {
      if (!ls.lmsAssignmentId) continue;

      // Match existing assignment in this course by lmsAssignmentId
      const existing = await db
        .select()
        .from(assignments)
        .where(
          and(
            eq(assignments.courseId, courseId),
            eq(assignments.lmsAssignmentId, ls.lmsAssignmentId)
          )
        );

      if (existing.length > 0) {
        // Update name, points, and gradebookID if they changed in LS
        await db
          .update(assignments)
          .set({
            name: ls.name,
            pointsPossible: ls.points,
            dueDate: ls.dueDate,
            lmsGradebookId: ls.lmsGradebookId || gradebookID || existing[0].lmsGradebookId,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(assignments.id, existing[0].id));
        synced.push({ id: existing[0].id, lmsAssignmentId: ls.lmsAssignmentId, name: ls.name });
        updated++;
      } else {
        // Create new assignment — only if it has online submissions enabled.
        // (Non-submission assignments are skipped; instructor can still create them manually.)
        if (!ls.hasOnlineSubmission) {
          synced.push({ id: -1, lmsAssignmentId: ls.lmsAssignmentId, name: ls.name });
          continue;
        }

        const result = await db
          .insert(assignments)
          .values({
            courseId,
            name: ls.name,
            pointsPossible: ls.points,
            dueDate: ls.dueDate,
            submissionType: "any",
            lmsAssignmentId: ls.lmsAssignmentId,
            lmsGradebookId: ls.lmsGradebookId || gradebookID || null,
          })
          .returning();
        synced.push({ id: result[0].id, lmsAssignmentId: ls.lmsAssignmentId, name: ls.name });
        added++;
      }
    }

    return NextResponse.json({ added, updated, synced, gradebookID }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("[ls-bridge/sync-assignments]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
