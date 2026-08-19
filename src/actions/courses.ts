"use server";

import { db } from "@/db";
import { courses, courseMembers, assignments, courseEnrollments, users } from "@/db/schema";
import { eq, desc, and, or, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require";
import { isTerm, termSortKey, type Term } from "@/lib/terms";
import { cloneRubric } from "./rubrics";
import { writeAudit } from "@/lib/audit";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` parsed as UTC midnight, matching the plain `<input type="date">` fields that produce it. */
function dateOnly(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

function toDateOnlyString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** courseIds this user is a member of — the filter every non-admin listing needs. */
function myCourseIds(userId: number) {
  return db.select({ courseId: courseMembers.courseId }).from(courseMembers).where(eq(courseMembers.userId, userId));
}

export async function getCourses(includeArchived = false) {
  const user = await requireCapability("course.view");
  const archivedFilter = includeArchived ? undefined : eq(courses.archived, 0);

  if (user.globalRole === "admin") {
    return archivedFilter
      ? db.select().from(courses).where(archivedFilter).orderBy(desc(courses.createdAt))
      : db.select().from(courses).orderBy(desc(courses.createdAt));
  }

  const membershipFilter = inArray(courses.id, myCourseIds(user.id));
  const where = archivedFilter ? and(archivedFilter, membershipFilter) : membershipFilter;
  return db.select().from(courses).where(where).orderBy(desc(courses.createdAt));
}

export async function getCourse(id: number) {
  await requireCapability("course.view", { kind: "course", courseId: id });
  const result = await db.select().from(courses).where(eq(courses.id, id));
  return result[0] || null;
}

/** Every year/term that has a course, newest first — populates the courses-page rail. */
export async function getCourseTerms(): Promise<{ year: number; term: Term }[]> {
  const user = await requireCapability("course.view");
  const where =
    user.globalRole === "admin"
      ? eq(courses.archived, 0)
      : and(eq(courses.archived, 0), inArray(courses.id, myCourseIds(user.id)));

  const rows = await db.selectDistinct({ year: courses.year, term: courses.term }).from(courses).where(where);

  return rows
    .filter((r): r is { year: number; term: Term } => isTerm(r.term))
    .sort((a, b) => termSortKey(b.year, b.term) - termSortKey(a.year, a.term));
}

/**
 * Everything usable as a copy source: the caller's own courses plus every
 * department-visible course from any owner — the same set `copyCourse()`'s
 * own `course.view` check on `sourceId` actually allows, so nothing shown
 * here is a dead end. Minimal fields only — this is what the Copy Course
 * picker browses, never roster or grade data (see roster.view in roles.ts).
 */
export async function getCoursesForCopy(): Promise<
  { id: number; name: string; code: string; section: string | null; year: number; term: Term; startDate: string | null }[]
> {
  const user = await requireCapability("course.view");
  const fields = {
    id: courses.id,
    name: courses.name,
    code: courses.code,
    section: courses.section,
    year: courses.year,
    term: courses.term,
    startDate: courses.startDate,
  };

  if (user.globalRole === "admin") {
    return db.select(fields).from(courses).where(eq(courses.archived, 0)).orderBy(desc(courses.createdAt));
  }

  const visibleFilter = or(eq(courses.visibility, "department"), inArray(courses.id, myCourseIds(user.id)));
  return db
    .select(fields)
    .from(courses)
    .where(and(eq(courses.archived, 0), visibleFilter))
    .orderBy(desc(courses.createdAt));
}

/** Every year/term with at least one copy-source course — feeds the picker's term rail. */
export async function getCourseTermsForCopy(): Promise<{ year: number; term: Term }[]> {
  const user = await requireCapability("course.view");
  const where =
    user.globalRole === "admin"
      ? eq(courses.archived, 0)
      : and(
          eq(courses.archived, 0),
          or(eq(courses.visibility, "department"), inArray(courses.id, myCourseIds(user.id)))
        );

  const rows = await db.selectDistinct({ year: courses.year, term: courses.term }).from(courses).where(where);

  return rows
    .filter((r): r is { year: number; term: Term } => isTerm(r.term))
    .sort((a, b) => termSortKey(b.year, b.term) - termSortKey(a.year, a.term));
}

/** The signed-in user's remembered courses-page filter, or null if never set. */
export async function getMyTermPreference(): Promise<{ year: number; term: Term } | null> {
  const user = await requireCapability("course.view");
  const [row] = await db
    .select({ year: users.defaultCourseYear, term: users.defaultCourseTerm })
    .from(users)
    .where(eq(users.id, user.id));

  if (!row || row.year == null || !isTerm(row.term)) return null;
  return { year: row.year, term: row.term };
}

export async function setMyTermPreference(year: number, term: Term): Promise<void> {
  const user = await requireCapability("course.view");
  await db
    .update(users)
    .set({ defaultCourseYear: year, defaultCourseTerm: term })
    .where(eq(users.id, user.id));
}

/**
 * The course whose detail page the instructor last opened.
 *
 * Scopes the global Assignments nav item so it shows one course's work
 * instead of everything at once — set by visiting any course's detail page,
 * not tied to a particular link, so every path there keeps it current.
 */
export async function setActiveCourse(courseId: number): Promise<void> {
  const user = await requireCapability("course.view");
  await db.update(users).set({ activeCourseId: courseId }).where(eq(users.id, user.id));
}

export async function getActiveCourse() {
  const user = await requireCapability("course.view");
  const [row] = await db
    .select({ activeCourseId: users.activeCourseId })
    .from(users)
    .where(eq(users.id, user.id));

  if (!row?.activeCourseId) return null;
  const [course] = await db.select().from(courses).where(eq(courses.id, row.activeCourseId));
  return course ?? null;
}

export async function createCourse(data: {
  name: string;
  code: string;
  section?: string;
  year: number;
  term: Term;
  visibility?: "private" | "department";
  startDate?: string;
}) {
  const user = await requireCapability("course.create");
  const [course] = await db
    .insert(courses)
    .values({
      name: data.name,
      code: data.code,
      section: data.section,
      year: data.year,
      term: data.term,
      visibility: data.visibility ?? "department",
      startDate: data.startDate ?? null,
    })
    .returning();

  // lineageId is a self-reference, so it needs the row's own generated id.
  await db.update(courses).set({ lineageId: course.id }).where(eq(courses.id, course.id));
  await db.insert(courseMembers).values({ courseId: course.id, userId: user.id, role: "owner", addedBy: user.id });

  revalidatePath("/courses");
  return { ...course, lineageId: course.id };
}

export async function updateCourse(
  id: number,
  data: Partial<{
    name: string;
    code: string;
    section: string;
    year: number;
    term: Term;
    visibility: "private" | "department";
    startDate: string;
  }>
) {
  await requireCapability("course.edit", { kind: "course", courseId: id });
  await db.update(courses).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(courses.id, id));
  revalidatePath("/courses");
  revalidatePath(`/courses/${id}`);
}

export async function deleteCourse(id: number) {
  const actor = await requireCapability("course.edit", { kind: "course", courseId: id });
  const [course] = await db.select({ name: courses.name, code: courses.code }).from(courses).where(eq(courses.id, id));
  await db.delete(courseEnrollments).where(eq(courseEnrollments.courseId, id));
  await db.delete(assignments).where(eq(assignments.courseId, id));
  await db.delete(courses).where(eq(courses.id, id));
  await writeAudit(actor, {
    action: "course.delete",
    targetType: "course",
    targetId: id,
    detail: { name: course?.name, code: course?.code },
  });
  revalidatePath("/courses");
}

export async function archiveCourse(id: number) {
  await requireCapability("course.edit", { kind: "course", courseId: id });
  await db.update(courses).set({ archived: 1, updatedAt: new Date().toISOString() }).where(eq(courses.id, id));
  revalidatePath("/courses");
}

/**
 * Copies a course into a brand-new one: independent from the moment it
 * exists, per docs/accounts-and-courses.md. Copies assignments and
 * deep-clones their rubrics (never a shared reference — editing the copy's
 * rubric must not touch the original's). Does not copy enrollments,
 * submissions, grades, or annotations.
 *
 * Due dates are rebased by day-offset, not cleared, when both the source's
 * and destination's start dates are known — `sourceStartDate` lets the
 * caller backfill a source course that has none on record as part of the
 * same call, so it's on file for future copies too.
 */
export async function copyCourse(
  sourceId: number,
  overrides: {
    name: string;
    code: string;
    section?: string;
    year: number;
    term: Term;
    startDate?: string;
    sourceStartDate?: string;
  }
) {
  await requireCapability("course.view", { kind: "course", courseId: sourceId });
  const user = await requireCapability("course.create");

  const [source] = await db.select().from(courses).where(eq(courses.id, sourceId));
  if (!source) throw new Error("Course not found.");

  let sourceStartDate = source.startDate;
  if (overrides.sourceStartDate && !sourceStartDate) {
    await db.update(courses).set({ startDate: overrides.sourceStartDate }).where(eq(courses.id, sourceId));
    sourceStartDate = overrides.sourceStartDate;
  }

  const [newCourse] = await db
    .insert(courses)
    .values({
      name: overrides.name,
      code: overrides.code,
      section: overrides.section,
      year: overrides.year,
      term: overrides.term,
      visibility: "department",
      lineageId: source.lineageId ?? source.id,
      copiedFromId: source.id,
      lmsCourseId: null,
      startDate: overrides.startDate ?? null,
    })
    .returning();

  await db.insert(courseMembers).values({ courseId: newCourse.id, userId: user.id, role: "owner", addedBy: user.id });

  const sourceStart = sourceStartDate ? dateOnly(sourceStartDate) : null;
  const destStart = overrides.startDate ? dateOnly(overrides.startDate) : null;
  const canRebase = !!sourceStart && !!destStart;

  const sourceAssignments = await db
    .select()
    .from(assignments)
    .where(eq(assignments.courseId, sourceId))
    .orderBy(assignments.sortOrder);

  // Two assignments sharing a rubric in the source must still share one
  // rubric in the copy — clone each distinct source rubric once, not once
  // per assignment that references it.
  const clonedRubricIds = new Map<number, number | null>();

  for (const a of sourceAssignments) {
    let newRubricId: number | null = null;
    if (a.rubricId) {
      if (clonedRubricIds.has(a.rubricId)) {
        newRubricId = clonedRubricIds.get(a.rubricId) ?? null;
      } else {
        const cloned = await cloneRubric(a.rubricId);
        newRubricId = cloned?.id ?? null;
        clonedRubricIds.set(a.rubricId, newRubricId);
      }
    }

    // Never cleared, only rebased when possible — a stale-but-present due
    // date beats a missing one.
    let newDueDate = a.dueDate;
    if (canRebase && a.dueDate) {
      const offsetDays = Math.round((dateOnly(a.dueDate).getTime() - sourceStart!.getTime()) / MS_PER_DAY);
      newDueDate = toDateOnlyString(new Date(destStart!.getTime() + offsetDays * MS_PER_DAY));
    }

    await db.insert(assignments).values({
      courseId: newCourse.id,
      rubricId: newRubricId,
      name: a.name,
      description: a.description,
      dueDate: newDueDate,
      pointsPossible: a.pointsPossible,
      submissionType: a.submissionType,
      sortOrder: a.sortOrder,
      lmsAssignmentId: null,
      lmsGradebookId: null,
      lmsDiscussionUrl: null,
    });
  }

  revalidatePath("/courses");
  return newCourse;
}
