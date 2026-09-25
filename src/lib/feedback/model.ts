import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { assignments, courses, gradeEntries, grades, rubricCriteria, rubricLevels, rubrics, students } from "@/db/schema";
import { fractionFor, HOUSE_LABELS, letterFor } from "@/lib/rubric";
import type { BandEdges, Level, Nudge } from "@/lib/rubric";
import { DEFAULT_BAND_EDGES } from "@/lib/rubric/bands";
import type { Term } from "@/lib/terms";
import type { GradeStatus } from "@/types/grading";
import { gradeFingerprint } from "./fingerprint";

/**
 * Everything one student's feedback shows, in one shape shared by the email
 * and the read-only feedback page so the two cannot drift.
 *
 * Grades are reported as letters, never points — per criterion and overall.
 * Nothing in here carries a point value, so neither renderer can leak one.
 *
 * No authorization here: callers (src/actions/feedback.ts for instructors,
 * the /feedback/[token] page for students) decide who may load this.
 */

export interface FeedbackLevel {
  label: string;
  description: string;
}

export interface FeedbackCriterion {
  name: string;
  description: string | null;
  levels: FeedbackLevel[];
  /** Index into `levels`, or null when this criterion was not scored. */
  selected: number | null;
  nudge: Nudge;
  letter: string | null;
  comment: string | null;
}

export interface FeedbackModel {
  assignment: { id: number; name: string };
  course: { id: number; code: string; name: string; year: number; term: Term };
  student: { id: number; name: string; sortName: string; email: string | null };
  gradeId: number | null;
  status: GradeStatus;
  letter: string | null;
  feedback: string | null;
  criteria: FeedbackCriterion[];
  fingerprint: string | null;
}

export async function loadFeedbackModel(assignmentId: number, studentId: number): Promise<FeedbackModel | null> {
  const [a] = await db.select().from(assignments).where(eq(assignments.id, assignmentId));
  if (!a) return null;
  const [course] = await db.select().from(courses).where(eq(courses.id, a.courseId));
  const [student] = await db.select().from(students).where(eq(students.id, studentId));
  if (!course || !student) return null;

  const [grade] = await db
    .select()
    .from(grades)
    .where(and(eq(grades.assignmentId, assignmentId), eq(grades.studentId, studentId)));
  const entries = grade ? await db.select().from(gradeEntries).where(eq(gradeEntries.gradeId, grade.id)) : [];

  const criteria: FeedbackCriterion[] = [];
  // Archived points-based rubrics store per-level points whose sum need not
  // match the assignment's points, so their overall letter comes from the
  // rubric's own totals instead. Null for share-model rubrics.
  let legacyTotals: { earned: number; possible: number; complete: boolean } | null = null;
  if (a.rubricId) {
    const [rubric] = await db.select().from(rubrics).where(eq(rubrics.id, a.rubricId));
    const settings = rubric?.settings
      ? (JSON.parse(rubric.settings) as { model?: string; bandEdges?: BandEdges })
      : null;
    const shareModel = settings?.model === "share";
    const bandEdges = settings?.bandEdges ?? DEFAULT_BAND_EDGES;

    const criterionRows = await db
      .select()
      .from(rubricCriteria)
      .where(and(eq(rubricCriteria.rubricId, a.rubricId), eq(rubricCriteria.archived, 0)))
      .orderBy(asc(rubricCriteria.sortOrder));

    if (!shareModel) legacyTotals = { earned: 0, possible: 0, complete: true };

    for (const c of criterionRows) {
      const levelRows = await db
        .select()
        .from(rubricLevels)
        .where(eq(rubricLevels.criteriaId, c.id))
        .orderBy(asc(rubricLevels.level));
      const entry = entries.find((e) => e.criteriaId === c.id);
      const selected = entry?.levelId != null ? levelRows.findIndex((l) => l.id === entry.levelId) : -1;
      const nudge: Nudge = entry?.nudge === 1 || entry?.nudge === -1 ? entry.nudge : 0;

      let letter: string | null = null;
      if (selected >= 0) {
        if (shareModel) {
          letter = letterFor(fractionFor(bandEdges, levelRows[selected].level as Level, nudge) * 100);
        } else {
          // Archived points-based rubrics: the level's share of the best level.
          const best = Math.max(...levelRows.map((l) => l.points ?? 0));
          if (best > 0 && entry?.score != null) letter = letterFor((entry.score / best) * 100);
        }
      }
      if (legacyTotals) {
        legacyTotals.possible += Math.max(0, ...levelRows.map((l) => l.points ?? 0));
        if (selected >= 0 && entry?.score != null) legacyTotals.earned += entry.score;
        else legacyTotals.complete = false;
      }

      criteria.push({
        name: c.name,
        description: c.description,
        levels: levelRows.map((l) => ({
          label: l.label || HOUSE_LABELS[l.level as Level] || `Level ${l.level}`,
          description: l.description,
        })),
        selected: selected >= 0 ? selected : null,
        nudge,
        letter,
        comment: entry?.comment?.trim() || null,
      });
    }
  }

  const status = (grade?.status ?? "ungraded") as GradeStatus;
  let percent: number | null = null;
  if (grade && (status === "graded" || status === "missing")) {
    if (legacyTotals?.complete && legacyTotals.possible > 0) {
      percent = (legacyTotals.earned / legacyTotals.possible) * 100;
    } else if (grade.totalScore != null && a.pointsPossible > 0) {
      percent = (grade.totalScore / a.pointsPossible) * 100;
    }
  }
  const letter = percent == null ? null : letterFor(percent);

  return {
    assignment: { id: a.id, name: a.name },
    course: { id: course.id, code: course.code, name: course.name, year: course.year, term: course.term },
    student: { id: student.id, name: displayName(student.name), sortName: student.sortName, email: student.email },
    gradeId: grade?.id ?? null,
    status,
    letter,
    feedback: grade?.feedback?.trim() || null,
    criteria,
    fingerprint: grade
      ? gradeFingerprint({
          status: grade.status,
          totalScore: grade.totalScore,
          feedback: grade.feedback,
          entries: entries.map((e) => ({ criteriaId: e.criteriaId, levelId: e.levelId, nudge: e.nudge, comment: e.comment })),
        })
      : null,
  };
}

/**
 * Roster names arrive from Learning Suite as "Last, First". An email opens
 * with the name the way a person would say it; anything else is left alone.
 */
export function displayName(name: string): string {
  const parts = name.split(",");
  if (parts.length !== 2) return name.trim();
  const [last, first] = parts.map((p) => p.trim());
  return first && last ? `${first} ${last}` : name.trim();
}
