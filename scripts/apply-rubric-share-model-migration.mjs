#!/usr/bin/env node
/**
 * Schema groundwork for the share-model rubric editor/grading tool
 * (src/lib/rubric/), which lives alongside the existing v1/v2/v3 editors
 * rather than replacing them:
 *
 *   - rubric_criteria.archived — soft-delete for the new editor's update
 *     path. A criterion with existing grade_entries can't be hard-deleted
 *     (FK), so it's archived instead. Legacy (v1/v2/v3) rows never set
 *     this; it defaults to 0 and their own update path is untouched.
 *   - rubric_levels.points — loosened from NOT NULL to nullable. Share-model
 *     levels store no points (computed from share + bandEdges); v1/v2/v3
 *     always write a real number, so this is a pure widening. SQLite can't
 *     ALTER COLUMN, so this is done as add/copy/drop/rename on the column
 *     alone — never touches rowids, so grade_entries.level_id stays valid
 *     throughout.
 *   - grade_entries.nudge — share-model only (-1|0|1); unused, NULL, for
 *     legacy entries.
 *
 * Column/table presence is checked directly rather than `IF NOT EXISTS`, so
 * this is idempotent and safe to re-run.
 *
 *   node scripts/apply-rubric-share-model-migration.mjs
 */
import Database from "better-sqlite3";

const dbPath = process.env.DB_PATH || "storage/grader.db";
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function tableInfo(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all();
}

function columns(table) {
  return tableInfo(table).map((c) => c.name);
}

function addColumnIfMissing(table, column, ddl) {
  if (!columns(table).includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    console.log(`Added ${table}.${column}`);
  }
}

const tx = db.transaction(() => {
  addColumnIfMissing("rubric_criteria", "archived", "archived integer DEFAULT 0 NOT NULL");
  addColumnIfMissing("grade_entries", "nudge", "nudge integer");

  const pointsCol = tableInfo("rubric_levels").find((c) => c.name === "points");
  if (pointsCol && pointsCol.notnull) {
    db.exec("ALTER TABLE rubric_levels ADD COLUMN points_new real");
    db.exec("UPDATE rubric_levels SET points_new = points");
    db.exec("ALTER TABLE rubric_levels DROP COLUMN points");
    db.exec("ALTER TABLE rubric_levels RENAME COLUMN points_new TO points");
    console.log("Loosened rubric_levels.points to nullable");
  }
});
tx();

const levelsPointsNotNull = tableInfo("rubric_levels").find((c) => c.name === "points")?.notnull;
console.log(
  `rubric_criteria.archived: ${columns("rubric_criteria").includes("archived")}, ` +
    `grade_entries.nudge: ${columns("grade_entries").includes("nudge")}, ` +
    `rubric_levels.points nullable: ${!levelsPointsNotNull}`
);
