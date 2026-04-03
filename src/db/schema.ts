import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ─── Courses ────────────────────────────────────────────

export const courses = sqliteTable("courses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  section: text("section"),
  semester: text("semester").notNull(),
  lmsCourseId: text("lms_course_id"),
  archived: integer("archived").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

// ─── Students ───────────────────────────────────────────

export const students = sqliteTable("students", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  lmsStudentId: text("lms_student_id"),
  netId: text("net_id"),
  name: text("name").notNull(),
  sortName: text("sort_name").notNull(),
  email: text("email"),
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
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const rubricCriteria = sqliteTable("rubric_criteria", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  rubricId: integer("rubric_id").notNull().references(() => rubrics.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull(),
  weight: real("weight").notNull().default(1.0),
});

export const rubricLevels = sqliteTable("rubric_levels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  criteriaId: integer("criteria_id").notNull().references(() => rubricCriteria.id, { onDelete: "cascade" }),
  level: integer("level").notNull(), // 0=lowest, 3=Professional
  label: text("label").notNull(),
  description: text("description").notNull(),
  points: real("points").notNull(),
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
}, (table) => [
  uniqueIndex("submission_unique_idx").on(table.assignmentId, table.studentId),
]);

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
