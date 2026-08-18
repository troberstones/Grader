import { sqliteTable, text, integer, real, blob, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type { Term } from "@/lib/terms";
import type { CourseRole } from "@/lib/auth/roles";

// ─── Courses ────────────────────────────────────────────

export const courses = sqliteTable("courses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  section: text("section"),
  year: integer("year").notNull(),
  term: text("term").notNull().$type<Term>(), // see src/lib/terms.ts
  lmsCourseId: text("lms_course_id"),
  archived: integer("archived").notNull().default(0),
  // 'department': any active instructor/assistant can view and copy it.
  // 'private': only course_members can view it; excluded from copy-source browsing.
  visibility: text("visibility").notNull().default("department"), // 'private' | 'department'
  // Copy provenance. lineageId is a self-reference: the first course in a copy
  // family points at its own id, every copy points at the same value, so the
  // whole family is one query. copiedFromId is one hop back, for "copied from X".
  lineageId: integer("lineage_id"),
  copiedFromId: integer("copied_from_id"),
  // Anchor for rebasing assignment due dates when this course is copied — see
  // copyCourse() in src/actions/courses.ts.
  startDate: text("start_date"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

// ─── Course Members ─────────────────────────────────────
// Per-course roles, closing COURSE_SCOPING_PENDING (src/lib/auth/roles.ts).
// A course always needs at least one 'owner' — enforced in
// src/actions/course-members.ts, not here.

export const courseMembers = sqliteTable("course_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  courseId: integer("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull().$type<CourseRole>(), // see src/lib/auth/roles.ts
  addedAt: text("added_at").notNull().default(sql`(datetime('now'))`),
  addedBy: integer("added_by").references(() => users.id),
}, (table) => [
  uniqueIndex("course_members_unique_idx").on(table.courseId, table.userId),
  index("course_members_user_idx").on(table.userId),
]);

// ─── Students ───────────────────────────────────────────

export const students = sqliteTable("students", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  lmsStudentId: text("lms_student_id"),
  netId: text("net_id"),
  name: text("name").notNull(),
  sortName: text("sort_name").notNull(),
  email: text("email"),
  // Nullable link to a login account. Unpopulated until student login exists
  // (see docs/student-accounts-plan.md) — exists now so that becomes a
  // population step later, not an identity merge.
  userId: integer("user_id").references(() => users.id),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("students_net_id_idx").on(table.netId),
]);

// ─── Course Enrollments ─────────────────────────────────

export const courseEnrollments = sqliteTable("course_enrollments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  courseId: integer("course_id").notNull().references(() => courses.id),
  studentId: integer("student_id").notNull().references(() => students.id),
  enrolledAt: text("enrolled_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("enrollment_unique_idx").on(table.courseId, table.studentId),
]);

// ─── Rubrics ────────────────────────────────────────────

export const rubrics = sqliteTable("rubrics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  settings: text("settings"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const rubricCriteria = sqliteTable("rubric_criteria", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  rubricId: integer("rubric_id").notNull().references(() => rubrics.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull(),
  // Read as "share" (relative importance) by the share-model engine
  // (src/lib/rubric/) — not renamed at the DB level because the legacy
  // editors (rubric-editor*.tsx) still read/write it as "weight".
  weight: real("weight").notNull().default(1.0),
  // Soft-delete for the share-model editor's update path: a criterion with
  // existing grade_entries can't be hard-deleted (FK), so it's archived
  // instead. Always 0 for rows never touched by that path.
  archived: integer("archived").notNull().default(0),
});

export const rubricLevels = sqliteTable("rubric_levels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  criteriaId: integer("criteria_id").notNull().references(() => rubricCriteria.id, { onDelete: "cascade" }),
  level: integer("level").notNull(), // 0=lowest, 3=Professional
  label: text("label").notNull(),
  description: text("description").notNull(),
  // Nullable: share-model rubrics (src/lib/rubric/) store no points here —
  // they're computed from the criterion's share and the rubric's bandEdges.
  // v1/v2/v3 always write a real number.
  points: real("points"),
});

// ─── Assignments ────────────────────────────────────────

export const assignments = sqliteTable("assignments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  courseId: integer("course_id").notNull().references(() => courses.id),
  rubricId: integer("rubric_id").references(() => rubrics.id),
  name: text("name").notNull(),
  description: text("description"),
  dueDate: text("due_date"),
  pointsPossible: real("points_possible").notNull(),
  submissionType: text("submission_type").notNull().default("image"), // 'image' | 'video' | 'any'
  lmsAssignmentId: text("lms_assignment_id"),
  lmsGradebookId: text("lms_gradebook_id"),
  lmsDiscussionUrl: text("lms_discussion_url"),
  // Preserved across course copy so a copied course's assignment order
  // matches the original.
  sortOrder: integer("sort_order").notNull().default(0),
  archived: integer("archived").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

// ─── Submissions ────────────────────────────────────────

export const submissions = sqliteTable("submissions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  assignmentId: integer("assignment_id").notNull().references(() => assignments.id),
  studentId: integer("student_id").notNull().references(() => students.id),
  filePath: text("file_path").notNull(),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(),
  fileSize: integer("file_size"),
  mediaType: text("media_type").notNull(), // 'image' | 'video'
  thumbnailPath: text("thumbnail_path"),
  frameCount: integer("frame_count"),
  fps: real("fps"),
  duration: real("duration"),
  submittedAt: text("submitted_at").notNull().default(sql`(datetime('now'))`),
});

// ─── Grades ─────────────────────────────────────────────

export const grades = sqliteTable("grades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  assignmentId: integer("assignment_id").notNull().references(() => assignments.id),
  studentId: integer("student_id").notNull().references(() => students.id),
  submissionId: integer("submission_id").references(() => submissions.id),
  totalScore: real("total_score"),
  feedback: text("feedback"),
  status: text("status").notNull().default("ungraded"), // 'ungraded' | 'in_progress' | 'graded'
  gradedAt: text("graded_at"),
  exportedAt: text("exported_at"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("grade_unique_idx").on(table.assignmentId, table.studentId),
]);

export const gradeEntries = sqliteTable("grade_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  gradeId: integer("grade_id").notNull().references(() => grades.id, { onDelete: "cascade" }),
  criteriaId: integer("criteria_id").notNull().references(() => rubricCriteria.id),
  levelId: integer("level_id").references(() => rubricLevels.id),
  score: real("score"),
  comment: text("comment"),
  // Share-model only (src/lib/rubric/): -1|0|1, a third of the way toward
  // the neighbouring band. Null/unused for legacy (v1/v2/v3) entries.
  nudge: integer("nudge"),
}, (table) => [
  uniqueIndex("grade_entry_unique_idx").on(table.gradeId, table.criteriaId),
]);

// ─── Annotations ────────────────────────────────────────

export const annotations = sqliteTable("annotations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  submissionId: integer("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
  gradeId: integer("grade_id").references(() => grades.id),
  frameNumber: integer("frame_number"), // NULL for images, specific frame for video
  annotationData: text("annotation_data").notNull(), // Fabric.js JSON
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const annotationHistory = sqliteTable("annotation_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  annotationId: integer("annotation_id").notNull().references(() => annotations.id, { onDelete: "cascade" }),
  annotationData: text("annotation_data").notNull(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

// ─── Art Review module ──────────────────────────────────────────────────
// Derivatives produced at ingest. Originals stay in `submissions`; these are
// the web-safe files the viewer actually opens (all-intra proxies, flattened
// PSD composites, layer rasters, posters).

export const reviewMedia = sqliteTable("review_media", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  submissionId: integer("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
  variant: text("variant").notNull(), // 'proxy' | 'poster' | 'composite' | 'layer' | 'page'
  idx: integer("idx").notNull().default(0),
  path: text("path").notNull(),
  mime: text("mime").notNull(),
  kind: text("kind"), // 'video' | 'still' | 'layered' | 'pages'
  width: integer("width"),
  height: integer("height"),
  fps: real("fps"),
  frameCount: integer("frame_count"),
  duration: real("duration"),
  colorPrimaries: text("color_primaries"),
  colorTransfer: text("color_transfer"),
  status: text("status").notNull().default("ready"), // 'pending' | 'ready' | 'failed'
  warnings: text("warnings"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index("review_media_submission_idx").on(table.submissionId, table.variant, table.idx),
]);

// Append-only stroke log with soft deletes.
//
// Not a replace-all blob per submission like `annotations`: two devices drawing
// on the same file must not clobber each other, a reconnecting device needs to
// fetch only what it missed (seq), and per-author undo needs the individual
// records. Soft delete keeps `seq` monotonic so the sync cursor stays valid.

export const reviewStrokes = sqliteTable("review_strokes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: text("item_id").notNull(),
  seq: integer("seq").notNull(),
  localId: text("local_id").notNull(),
  frameIn: integer("frame_in").notNull().default(0),
  frameOut: integer("frame_out").notNull().default(0),
  authorId: text("author_id").notNull(),
  data: blob("data", { mode: "buffer" }).notNull(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  deletedAt: text("deleted_at"),
}, (table) => [
  index("review_strokes_item_frame_idx").on(table.itemId, table.frameIn),
  index("review_strokes_item_seq_idx").on(table.itemId, table.seq),
  // Makes an append idempotent: a retried POST cannot duplicate a stroke.
  uniqueIndex("review_strokes_local_idx").on(table.itemId, table.localId),
]);

// ─── Accounts ───────────────────────────────────────────────────────────
// See docs/accounts-and-courses.md. Three rules encoded here:
//
//   - `netId` exists from the start though nothing populates it yet, so that
//     CAS/SSO can eventually replace local passwords as a column update rather
//     than a merge of two identity systems.
//   - `passwordHash` is nullable: an invited user exists before they have a
//     password, which is what makes the admin list show pending invitations.
//   - Sessions are server-side rows, not JWTs, because disabling an account has
//     to log it out immediately.

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull(),
  netId: text("net_id"),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  globalRole: text("global_role").notNull().default("instructor"), // 'admin' | 'instructor' | 'assistant'
  status: text("status").notNull().default("invited"), // 'invited' | 'active' | 'disabled'
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  lastLoginAt: text("last_login_at"),
  // Remembered courses-page filter, so it follows the instructor across
  // machines instead of resetting every time they sign in somewhere new.
  defaultCourseYear: integer("default_course_year"),
  defaultCourseTerm: text("default_course_term"),
  // The course whose detail page the instructor last opened — scopes the
  // global Assignments nav item instead of it always listing everything.
  activeCourseId: integer("active_course_id"),
  // Admin-grantable, independent of any course membership: sees any
  // student's cross-course archive (src/actions/archive.ts). Deliberately
  // not implied by sharing a student with another instructor — teaching a
  // student in one course must not silently expose their record elsewhere.
  canViewArchive: integer("can_view_archive").notNull().default(0),
}, (table) => [
  uniqueIndex("users_email_idx").on(table.email),
  uniqueIndex("users_net_id_idx").on(table.netId),
]);

// Only the SHA-256 of the cookie value is stored, so read access to the
// database is not the same thing as the ability to forge a session.
export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tokenHash: text("token_hash").notNull(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  userAgent: text("user_agent"),
  ip: text("ip"),
}, (table) => [
  uniqueIndex("sessions_token_idx").on(table.tokenHash),
  index("sessions_user_idx").on(table.userId),
]);

// Single-use invitation tokens. Account creation is invite-only: no self
// signup, and no administrator ever knows another person's password.
export const invites = sqliteTable("invites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  invitedBy: integer("invited_by").references(() => users.id),
  expiresAt: text("expires_at").notNull(),
  acceptedAt: text("accepted_at"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("invites_token_idx").on(table.tokenHash),
  index("invites_user_idx").on(table.userId),
]);

// Per-user viewer preferences (fps, loop mode, flips) scoped to a context.
export const reviewPrefs = sqliteTable("review_prefs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contextId: text("context_id").notNull(),
  data: text("data").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("review_prefs_context_idx").on(table.contextId),
]);
