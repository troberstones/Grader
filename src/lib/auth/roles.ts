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

export const GLOBAL_ROLES = ["admin", "instructor", "assistant", "student"] as const;
export type GlobalRole = (typeof GLOBAL_ROLES)[number];

export const USER_STATUSES = ["invited", "active", "disabled"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Per-course role, stored in `course_members`. See the table in can() below. */
export const COURSE_ROLES = ["owner", "instructor", "ta", "observer"] as const;
export type CourseRole = (typeof COURSE_ROLES)[number];

export function isGlobalRole(v: unknown): v is GlobalRole {
  return typeof v === "string" && (GLOBAL_ROLES as readonly string[]).includes(v);
}

export function isUserStatus(v: unknown): v is UserStatus {
  return typeof v === "string" && (USER_STATUSES as readonly string[]).includes(v);
}

export function isCourseRole(v: unknown): v is CourseRole {
  return typeof v === "string" && (COURSE_ROLES as readonly string[]).includes(v);
}

/** The minimum an authorization decision needs. Never the password hash. */
export interface Principal {
  id: number;
  globalRole: GlobalRole;
  status: UserStatus;
  canViewArchive: boolean;
}

export type Capability =
  | "user.manage" // invite, disable, change role, force logout
  | "course.create"
  | "course.view"
  | "course.edit" // assignments, rubrics, roster
  | "course.members.manage" // add/remove/reassign course_members rows
  | "roster.view" // any real per-student data — names/netIds/emails, submissions, grades, review content — never covered by department visibility
  | "grade.write"
  | "grade.publish"
  | "archive.view"; // a student's cross-course submissions/grades/annotations

export type Resource =
  | { kind: "global" }
  | { kind: "course"; courseId: number }
  | { kind: "assignment"; assignmentId: number; courseId: number }
  | { kind: "submission"; submissionId: number; courseId: number }
  | { kind: "student"; studentId: number };

export const GLOBAL: Resource = { kind: "global" };

/**
 * Resolved course/student context for the `resource` passed to `can()`.
 *
 * `can()` stays a pure function of its arguments — no database access — so
 * whichever caller needs a real answer (requireCapability / apiRequireCapability)
 * resolves this first, via resolveAuthContext() in ./course-context, and passes
 * it in. See docs/accounts-and-courses.md for why resource-shaped checks matter.
 */
export interface AuthContext {
  /** This user's role in the resource's course, or null if not a member. */
  courseMembership?: CourseRole | null;
  /** The resource's course visibility. Only meaningful without membership. */
  courseVisibility?: "private" | "department";
  /** True if the resource's studentId is linked (students.userId) to this user. */
  isOwnStudentRecord?: boolean;
}

/**
 * Per-course membership does not exist yet — `course_members` lands with course
 * scoping, and until then every active instructor can reach every course.
 *
 * This constant is exported so the places making that assumption are greppable
 * rather than merely commented. Search for it before believing that course
 * authorization is enforced.
 *
 * @deprecated Closed by course_members + AuthContext below. Kept as a marker
 * during the migration window in case any stray call site still assumes it.
 */
export const COURSE_SCOPING_PENDING = false;

export function can(
  user: Principal | null | undefined,
  capability: Capability,
  resource: Resource = GLOBAL,
  ctx: AuthContext = {},
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
      if (resource.kind === "student") return false;
      if (resource.kind === "global") {
        // Coarse "is this the kind of user who may call a listing action"
        // gate — the listing action itself filters rows to what the caller
        // is actually a member of. See getCourses()/getCourseTerms().
        return user.globalRole === "instructor" || user.globalRole === "assistant";
      }
      if (ctx.courseMembership != null) return true;
      // No membership: department-visible courses are still browsable (and
      // therefore copyable) by any active instructor/assistant.
      return (
        ctx.courseVisibility === "department" &&
        (user.globalRole === "instructor" || user.globalRole === "assistant")
      );

    case "course.edit":
      if (resource.kind === "student") return false;
      if (resource.kind === "global") {
        // Rubrics are a global library, not course-scoped (see
        // docs/accounts-and-courses.md) — src/actions/rubrics.ts calls this
        // capability with no resource, same as before course_members
        // existed. Course/assignment/submission edits below are the ones
        // that actually need membership.
        return user.globalRole === "instructor" || user.globalRole === "assistant";
      }
      return ctx.courseMembership === "owner" || ctx.courseMembership === "instructor";

    case "course.members.manage":
      if (resource.kind !== "course") return false;
      return ctx.courseMembership === "owner";

    case "roster.view":
      // Deliberately does NOT honor department visibility, unlike
      // course.view. That bypass exists so a non-member can browse a
      // course's assignment/rubric structure to decide whether to copy it —
      // it was never meant to expose real per-student data (roster,
      // submissions, grades, review content/annotations) to every
      // instructor in the department. Gates all of that, not just the
      // roster page, so it accepts any resource with a courseId — same
      // pattern as course.edit/grade.write below.
      if (resource.kind === "global" || resource.kind === "student") return false;
      return ctx.courseMembership != null;

    case "grade.write":
      if (resource.kind === "global" || resource.kind === "student") return false;
      return (
        ctx.courseMembership === "owner" ||
        ctx.courseMembership === "instructor" ||
        ctx.courseMembership === "ta"
      );

    case "grade.publish":
      if (resource.kind === "global" || resource.kind === "student") return false;
      return ctx.courseMembership === "owner" || ctx.courseMembership === "instructor";

    case "archive.view":
      if (resource.kind === "global") return user.canViewArchive === true;
      if (resource.kind !== "student") return false;
      return user.canViewArchive === true || ctx.isOwnStudentRecord === true;

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
  student: "Student",
};

export const ROLE_DESCRIPTIONS: Record<GlobalRole, string> = {
  admin: "Manages accounts and roles, and can reach every course.",
  instructor: "Creates courses and is added as a member of others.",
  assistant: "Grades in courses they are added to, but creates none.",
  // Not yet selectable from the invite UI — see docs/student-accounts-plan.md.
  student: "Views their own archived work once student login exists.",
};

export const COURSE_ROLE_LABELS: Record<CourseRole, string> = {
  owner: "Owner",
  instructor: "Instructor",
  ta: "TA",
  observer: "Observer",
};

export const COURSE_ROLE_DESCRIPTIONS: Record<CourseRole, string> = {
  owner: "Full control: roster, assignments, rubrics, grading, publishing, and members.",
  instructor: "Full control except managing course members.",
  ta: "Views roster and assignments and can grade, but cannot publish or edit rubrics.",
  observer: "Views the roster and assignments; cannot grade.",
};
