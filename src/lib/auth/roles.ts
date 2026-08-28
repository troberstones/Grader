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

/**
 * What the signed-in session is *for*, chosen at sign-in and fixed until sign-out.
 *
 * `review` is the critique-room session: the artwork, the annotation tools and
 * the student list, and nothing that evaluates anybody. It exists because the
 * screen is often projected in front of the class, where a rubric or a score is
 * exactly the wrong thing to reveal.
 *
 * This is a constraint on a session, not a role — the same instructor holds the
 * same permissions either way. Review mode subtracts from what they may do
 * right now; it never grants anything a `grade` session lacks.
 */
export const SESSION_MODES = ["grade", "review"] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

export function isSessionMode(v: unknown): v is SessionMode {
  return typeof v === "string" && (SESSION_MODES as readonly string[]).includes(v);
}

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
  /** The mode this session was opened in. See SESSION_MODES. */
  mode: SessionMode;
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
  | "annotation.write" // marking up the artwork itself — survives review mode, unlike grade.write
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

/**
 * Everything a `review` session may still do. An allow-list, deliberately.
 *
 * A deny-list would mean every capability added later is permitted in review
 * mode until someone remembers to exclude it, and the failure is silent — a
 * grading control quietly appearing in the critique room. This way the default
 * for anything new is "locked", and the failure is loud and immediate instead.
 *
 * `annotation.write` is the one write that survives: marking up the artwork is
 * the entire point of the review session. It is a separate capability from
 * `grade.write` for exactly this reason — before, annotations were gated on
 * `grade.write`, so there was no way to keep drawing while withholding grading.
 *
 * `archive.view` is deliberately absent despite being a read. The archive is a
 * student's work *and their grades* across courses, so admitting it would put
 * scores back on the projected screen through a side door.
 */
const REVIEW_MODE_CAPABILITIES: ReadonlySet<Capability> = new Set([
  "course.view",
  "roster.view",
  "annotation.write",
]);

export function can(
  user: Principal | null | undefined,
  capability: Capability,
  resource: Resource = GLOBAL,
  ctx: AuthContext = {},
): boolean {
  // A disabled or not-yet-accepted account can do nothing at all. This is the
  // check that makes "disable" meaningful, so it comes before everything.
  if (!user || user.status !== "active") return false;

  // Before the admin bypass, not after. An administrator who picks "review" at
  // sign-in is asking for the restricted session, and is in fact the likeliest
  // person to be standing in front of the class when they do; letting the
  // bypass win here would make the whole mode decorative for the one account
  // that most needs it.
  if (user.mode === "review" && !REVIEW_MODE_CAPABILITIES.has(capability)) return false;

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

    case "annotation.write":
      // The same people who may grade may annotate — this capability exists to
      // survive review mode, not to widen who can mark up a submission. An
      // observer still cannot draw on someone's work.
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
