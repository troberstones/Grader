/**
 * Capabilities.
 *
 * The signature takes a **resource**, not a course id, and that is the single
 * most consequential decision in docs/accounts-and-courses.md. Students, when
 * they arrive, are not members of a course — they are the subject of particular
 * submissions and grades. A check shaped around course membership cannot say
 * "may read this because it is theirs", so adding students to a membership-
 * shaped check means rewriting every call site. A resource-shaped one takes
 * another rule.
 *
 * Everything here is a pure function of a principal, so it is testable without
 * a database and safe to call from anywhere.
 */

export const GLOBAL_ROLES = ["admin", "instructor", "assistant"] as const;
export type GlobalRole = (typeof GLOBAL_ROLES)[number];

export const USER_STATUSES = ["invited", "active", "disabled"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export function isGlobalRole(v: unknown): v is GlobalRole {
  return typeof v === "string" && (GLOBAL_ROLES as readonly string[]).includes(v);
}

export function isUserStatus(v: unknown): v is UserStatus {
  return typeof v === "string" && (USER_STATUSES as readonly string[]).includes(v);
}

/** The minimum an authorization decision needs. Never the password hash. */
export interface Principal {
  id: number;
  globalRole: GlobalRole;
  status: UserStatus;
}

export type Capability =
  | "user.manage" // invite, disable, change role, force logout
  | "course.create"
  | "course.view"
  | "course.edit" // assignments, rubrics, roster
  | "grade.write"
  | "grade.publish";

export type Resource =
  | { kind: "global" }
  | { kind: "course"; courseId: number }
  | { kind: "assignment"; assignmentId: number; courseId: number }
  | { kind: "submission"; submissionId: number; courseId: number };

export const GLOBAL: Resource = { kind: "global" };

/**
 * Per-course membership does not exist yet — `course_members` lands with course
 * scoping, and until then every active instructor can reach every course.
 *
 * This constant is exported so the places making that assumption are greppable
 * rather than merely commented. Search for it before believing that course
 * authorization is enforced.
 */
export const COURSE_SCOPING_PENDING = true;

export function can(
  user: Principal | null | undefined,
  capability: Capability,
  resource: Resource = GLOBAL,
): boolean {
  // A disabled or not-yet-accepted account can do nothing at all. This is the
  // check that makes "disable" meaningful, so it comes before everything.
  if (!user || user.status !== "active") return false;

  if (user.globalRole === "admin") return true;

  switch (capability) {
    case "user.manage":
      return false;

    case "course.create":
      return user.globalRole === "instructor";

    case "course.view":
    case "course.edit":
    case "grade.write":
    case "grade.publish":
      // COURSE_SCOPING_PENDING: should consult course_members for `resource`.
      void resource;
      return user.globalRole === "instructor" || user.globalRole === "assistant";

    default:
      return false;
  }
}

/** Convenience for the common "is this an administrator" question. */
export function isAdmin(user: Principal | null | undefined): boolean {
  return !!user && user.status === "active" && user.globalRole === "admin";
}

export const ROLE_LABELS: Record<GlobalRole, string> = {
  admin: "Administrator",
  instructor: "Instructor",
  assistant: "Assistant",
};

export const ROLE_DESCRIPTIONS: Record<GlobalRole, string> = {
  admin: "Manages accounts and roles, and can reach every course.",
  instructor: "Creates and teaches courses.",
  assistant: "Grades in courses they are added to, but creates none.",
};
