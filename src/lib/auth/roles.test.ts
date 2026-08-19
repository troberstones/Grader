import { describe, expect, it } from "vitest";
import { can, type Principal } from "./roles";

const instructor: Principal = { id: 1, globalRole: "instructor", status: "active", canViewArchive: false };
const admin: Principal = { id: 2, globalRole: "admin", status: "active", canViewArchive: false };

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
