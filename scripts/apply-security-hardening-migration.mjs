#!/usr/bin/env node
/**
 * Applies drizzle/0010_security_hardening.sql: login-lockout columns on
 * `users`, and the new `audit_log` table.
 *
 * Column/table presence is checked directly rather than `IF NOT EXISTS`, so
 * this is idempotent and safe to re-run. No backfill needed — the new
 * columns default sensibly for existing rows, and the audit log simply has
 * no history before this ships.
 *
 *   node scripts/apply-security-hardening-migration.mjs
 */
import Database from "better-sqlite3";

const dbPath = process.env.DB_PATH || "storage/grader.db";
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function columns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function addColumnIfMissing(table, column, ddl) {
  if (!columns(table).includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    console.log(`Added ${table}.${column}`);
  }
}

function tableExists(table) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}

const tx = db.transaction(() => {
  addColumnIfMissing("users", "failed_login_attempts", "failed_login_attempts integer DEFAULT 0 NOT NULL");
  addColumnIfMissing("users", "locked_until", "locked_until text");

  if (!tableExists("audit_log")) {
    db.exec(`
      CREATE TABLE audit_log (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        actor_id integer REFERENCES users(id),
        actor_email text NOT NULL,
        action text NOT NULL,
        target_type text,
        target_id integer,
        detail text,
        ip text,
        created_at text DEFAULT (datetime('now')) NOT NULL
      )
    `);
    db.exec("CREATE INDEX audit_log_actor_idx ON audit_log (actor_id)");
    db.exec("CREATE INDEX audit_log_target_idx ON audit_log (target_type, target_id)");
    db.exec("CREATE INDEX audit_log_created_idx ON audit_log (created_at)");
    console.log("Created audit_log");
  }
});
tx();

const auditCount = db.prepare("SELECT count(*) AS n FROM audit_log").get().n;
console.log(`audit_log table: ${auditCount} row(s) total.`);
