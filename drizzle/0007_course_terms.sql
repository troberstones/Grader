ALTER TABLE courses ADD COLUMN year integer;
--> statement-breakpoint
ALTER TABLE courses ADD COLUMN term text;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN default_course_year integer;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN default_course_term text;
--> statement-breakpoint
ALTER TABLE courses DROP COLUMN semester;
