import { describe, expect, it } from "vitest";
import { can, type Principal } from "./roles";

const instructor: Principal = { id: 1, globalRole: "instructor", status: "active", canViewArchive: false, mode: "grade" };
const admin: Principal = { id: 2, globalRole: "admin", status: "active", canViewArchive: false, mode: "grade" };

const courseResource = { kind: "course", courseId: 42 } as const;

describe("roster.view — real per-student data, never department-visibility", () => {
  it("allows a real course member", () => {
    expect(
      can(instructor, "roster.view", courseResource, { courseMembership: "ta", courseVisibility: "department" })
    ).toBe(true);
  });

  it("denies a non-member on a department-visible course", () => {
    expect(
      can(instructor, "roster.view", courseResource, { courseMembership: null, courseVisibility: "department" })
    ).toBe(false);
  });

  it("denies a non-member on a private course", () => {
    expect(
      can(instructor, "roster.view", courseResource, { courseMembership: null, courseVisibility: "private" })
    ).toBe(false);
  });

  it("always allows an admin", () => {
    expect(
      can(admin, "roster.view", courseResource, { courseMembership: null, courseVisibility: "department" })
    ).toBe(true);
  });

  it("gates assignment- and submission-shaped resources the same as course-shaped ones", () => {
    const assignmentResource = { kind: "assignment", assignmentId: 1, courseId: 42 } as const;
    expect(
      can(instructor, "roster.view", assignmentResource, { courseMembership: null, courseVisibility: "department" })
    ).toBe(false);
    expect(
      can(instructor, "roster.view", assignmentResource, { courseMembership: "owner", courseVisibility: "department" })
    ).toBe(true);

    const submissionResource = { kind: "submission", submissionId: 1, courseId: 42 } as const;
    expect(
      can(instructor, "roster.view", submissionResource, { courseMembership: null, courseVisibility: "department" })
    ).toBe(false);
    expect(
      can(instructor, "roster.view", submissionResource, { courseMembership: "instructor", courseVisibility: "department" })
    ).toBe(true);
  });

  it("denies global and student-shaped resources outright", () => {
    expect(can(instructor, "roster.view", { kind: "global" })).toBe(false);
    expect(can(instructor, "roster.view", { kind: "student", studentId: 1 }, { isOwnStudentRecord: true })).toBe(false);
  });
});

describe("course.view — still permissive for structure browsing (unchanged)", () => {
  it("allows a non-member to browse a department-visible course", () => {
    expect(
      can(instructor, "course.view", courseResource, { courseMembership: null, courseVisibility: "department" })
    ).toBe(true);
  });

  it("still denies a non-member on a private course", () => {
    expect(
      can(instructor, "course.view", courseResource, { courseMembership: null, courseVisibility: "private" })
    ).toBe(false);
  });
});


describe("review mode — a session constraint, not a role", () => {
  const reviewing: Principal = { ...instructor, mode: "review" };
  const reviewingAdmin: Principal = { ...admin, mode: "review" };
  const member = { courseMembership: "owner", courseVisibility: "department" } as const;
  const submission = { kind: "submission", submissionId: 7, courseId: 42 } as const;

  it("keeps the review session working: artwork, annotation and the student list", () => {
    expect(can(reviewing, "roster.view", courseResource, member)).toBe(true);
    expect(can(reviewing, "course.view", courseResource, member)).toBe(true);
    expect(can(reviewing, "annotation.write", submission, member)).toBe(true);
  });

  it("locks the archive — it carries grades across courses, not just artwork", () => {
    const student = { kind: "student", studentId: 3 } as const;
    const archivist: Principal = { ...instructor, canViewArchive: true };
    expect(can(archivist, "archive.view", student, { isOwnStudentRecord: false })).toBe(true);
    expect(can({ ...archivist, mode: "review" }, "archive.view", student, {})).toBe(false);
  });

  it("locks grading and editing that the same user may do in a grade session", () => {
    for (const cap of ["grade.write", "grade.publish", "course.edit"] as const) {
      expect(can(instructor, cap, courseResource, member)).toBe(true);
      expect(can(reviewing, cap, courseResource, member)).toBe(false);
    }
  });

  it("locks an admin too — the bypass must not outrank the mode", () => {
    expect(can(admin, "grade.write", courseResource, member)).toBe(true);
    expect(can(reviewingAdmin, "grade.write", courseResource, member)).toBe(false);
    expect(can(reviewingAdmin, "user.manage")).toBe(false);
    expect(can(reviewingAdmin, "course.edit", courseResource, member)).toBe(false);
  });

  it("still annotates only where a grade session could have", () => {
    // The capability exists to survive review mode, not to widen who may draw.
    expect(can(reviewing, "annotation.write", submission, { courseMembership: "observer" })).toBe(false);
    expect(can(reviewing, "annotation.write", submission, { courseMembership: null })).toBe(false);
  });

  it("never grants anything a grade session lacks", () => {
    const caps = [
      "user.manage", "course.create", "course.view", "course.edit", "course.members.manage",
      "roster.view", "grade.write", "grade.publish", "annotation.write", "archive.view",
    ] as const;
    for (const cap of caps) {
      if (can(reviewing, cap, courseResource, member)) {
        expect(can(instructor, cap, courseResource, member)).toBe(true);
      }
    }
  });
});
