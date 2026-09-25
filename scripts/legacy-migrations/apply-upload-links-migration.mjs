#!/usr/bin/env node
/**
 * Applies drizzle/0011_upload_links.sql: the `upload_links` table, for
 * expiring links that let a student submit media without signing in.
 *
 * Table presence is checked directly rather than `IF NOT EXISTS`, so this is
 * idempotent and safe to re-run.
 *
 *   node scripts/apply-upload-links-migration.mjs
 */
import Database from "better-sqlite3";

const dbPath = process.env.DB_PATH || "storage/grader.db";
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function tableExists(table) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}

const tx = db.transaction(() => {
  if (!tableExists("upload_links")) {
    db.exec(`
      CREATE TABLE upload_links (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        assignment_id integer NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
        student_id integer REFERENCES students(id) ON DELETE CASCADE,
        token_hash text NOT NULL,
        created_by integer REFERENCES users(id),
        expires_at text NOT NULL,
        revoked_at text,
        created_at text DEFAULT (datetime('now')) NOT NULL
      )
    `);
    db.exec("CREATE UNIQUE INDEX upload_links_token_idx ON upload_links (token_hash)");
    db.exec("CREATE INDEX upload_links_assignment_idx ON upload_links (assignment_id, student_id)");
    console.log("Created upload_links");
  }
});
tx();

const count = db.prepare("SELECT count(*) AS n FROM upload_links").get().n;
console.log(`upload_links table: ${count} row(s) total.`);
