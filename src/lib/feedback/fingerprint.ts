/**
 * A short, stable summary of everything a student would see in their
 * feedback: the status, score, overall comment, and every rubric selection.
 *
 * Stored on each `feedback_sends` row and compared against the grade as it is
 * now, so "Graded" can skip a student who already has their feedback unless
 * something has actually changed. `grades.updatedAt` cannot do this job: it
 * moves on every autosave, whether or not anything the student sees did.
 *
 * Pure, with no Node imports, because the grade sheet recomputes it in the
 * browser after each save to flip the sidebar's "changed since emailed" mark.
 */

export interface FingerprintGrade {
  status: string;
  totalScore: number | null;
  feedback: string | null;
  entries: { criteriaId: number; levelId: number | null; nudge?: number | null; comment?: string | null }[];
}

export function gradeFingerprint(grade: FingerprintGrade | null | undefined): string | null {
  if (!grade) return null;
  const entries = [...grade.entries]
    .sort((a, b) => a.criteriaId - b.criteriaId)
    .map((e) => [e.criteriaId, e.levelId ?? null, e.nudge ?? 0, (e.comment ?? "").trim()]);
  const canonical = JSON.stringify([
    grade.status,
    grade.totalScore == null ? null : Math.round(grade.totalScore * 10) / 10,
    (grade.feedback ?? "").trim(),
    entries,
  ]);
  return fnv1a(canonical);
}

/** 32-bit FNV-1a, hex. Change detection, not security — collisions only cost a skipped resend. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
