/**
 * GET /api/ls-bridge/assignment-sync-info?assignmentId=N[&includeGrades=true]
 *
 * Returns everything the extension's content_grader.js needs to:
 *   • Sync student submission files from LS  (studentMap + lmsAssignmentId + gradebookID)
 *   • Push grades back to LS                 (grades array when includeGrades=true)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  assignments,
  courseEnrollments,
  students,
  grades,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const assignmentId = Number(searchParams.get("assignmentId"));
  const includeGrades = searchParams.get("includeGrades") === "true";

  if (!assignmentId) {
    return NextResponse.json(
      { error: "assignmentId is required" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    // Load the assignment
    const [assignment] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.id, assignmentId));

    if (!assignment) {
      return NextResponse.json(
        { error: "Assignment not found" },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    // Load all enrolled students for this course
    const enrolledStudents = await db
      .select({
        graderStudentId: students.id,
        name: students.name,
        sortName: students.sortName,
        netId: students.netId,
        lmsStudentId: students.lmsStudentId,
      })
      .from(courseEnrollments)
      .innerJoin(students, eq(courseEnrollments.studentId, students.id))
      .where(eq(courseEnrollments.courseId, assignment.courseId));

    // Include all students — matching by lmsStudentId OR sortName in content_ls.js
    const studentMap = enrolledStudents.map((s) => ({
      graderStudentId: s.graderStudentId,
      lmsStudentId: s.lmsStudentId ?? null,
      sortName: s.sortName,
      name: s.name,
      netId: s.netId,
    }));

    const response: Record<string, unknown> = {
      assignmentId: assignment.id,
      name: assignment.name,
      lmsAssignmentId: assignment.lmsAssignmentId,
      gradebookID: assignment.lmsGradebookId,
      students: studentMap,
    };

    if (includeGrades) {
      // Load all graded records for this assignment
      const gradeRows = await db
        .select({
          studentId: grades.studentId,
          totalScore: grades.totalScore,
          feedback: grades.feedback,
          status: grades.status,
        })
        .from(grades)
        .where(
          and(
            eq(grades.assignmentId, assignmentId),
            eq(grades.status, "graded")
          )
        );

      // Join with studentMap to get LS IDs
      const gradesToPush = gradeRows
        .map((g) => {
          const student = studentMap.find((s) => s.graderStudentId === g.studentId);
          if (!student) return null;
          return {
            lmsStudentId: student.lmsStudentId,
            lmsAssignmentId: assignment.lmsAssignmentId,
            gradebookID: assignment.lmsGradebookId,
            score: g.totalScore ?? 0,
            note: g.feedback ?? "",
          };
        })
        .filter(
          (g): g is NonNullable<typeof g> =>
            g !== null && g.lmsAssignmentId !== null && g.gradebookID !== null
        );

      response.grades = gradesToPush;
    }

    return NextResponse.json(response, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("[ls-bridge/assignment-sync-info]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
