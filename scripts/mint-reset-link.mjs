#!/usr/bin/env node
/**
 * Mints a single-use password-reset link for one account, straight against the
 * database — the escape hatch for when the sole admin cannot reach
 * /admin/users to click "Reset password" for themselves.
 *
 * Mirrors resetPassword() in src/actions/auth.ts exactly: any unconsumed
 * invite for the user is cleared first (two simultaneously-valid reset links
 * would be a footgun), then a fresh 32-byte token is stored as its SHA-256.
 * The token is printed once, here, and never persisted in the clear.
 *
 * No password is read, written, or chosen by this script — the account owner
 * sets theirs in the browser at the printed URL.
 *
 *   node scripts/mint-reset-link.mjs someone@cs.byu.edu
 */
import Database from "better-sqlite3";
import { createHash, randomBytes } from "node:crypto";

const email = process.argv[2];
if (!email) {
  console.error("Usage: node scripts/mint-reset-link.mjs <email>");
  process.exit(1);
}

const dbPath = process.env.DB_PATH || "storage/grader.db";
const baseUrl = process.env.APP_BASE_URL || "http://cs-1017245.cs.byu.edu:3000";
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // matches src/lib/auth/tokens.ts

const db = new Database(dbPath);
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = ON");

const user = db
  .prepare("SELECT id, email, name, status FROM users WHERE lower(email) = lower(?)")
  .get(email);

if (!user) {
  console.error(`No account with email ${email}.`);
  process.exit(1);
}
if (user.status !== "active") {
  console.error(`Account ${user.email} is '${user.status}' — only an active account can be reset.`);
  process.exit(1);
}

// Same timestamp format SQLite's datetime('now') produces, in UTC.
const sqlTimestamp = (d) => d.toISOString().replace("T", " ").slice(0, 19);

const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
const expiresAt = sqlTimestamp(new Date(Date.now() + INVITE_TTL_MS));

db.transaction(() => {
  db.prepare("DELETE FROM invites WHERE user_id = ? AND accepted_at IS NULL").run(user.id);
  db.prepare(
    "INSERT INTO invites (user_id, token_hash, invited_by, expires_at) VALUES (?, ?, ?, ?)"
  ).run(user.id, tokenHash, user.id, expiresAt);

  // Best-effort, exactly as src/lib/audit.ts treats it: never block the action.
  try {
    db.prepare(
      `INSERT INTO audit_log (actor_id, actor_email, action, target_type, target_id, detail)
       VALUES (?, ?, 'user.password_reset_issued', 'user', ?, ?)`
    ).run(user.id, user.email, user.id, JSON.stringify({ email: user.email, via: "mint-reset-link.mjs" }));
  } catch (e) {
    console.warn(`(audit_log not written: ${e.message})`);
  }
})();

db.close();

console.log(`\nReset link for ${user.name} <${user.email}> — single use, expires ${expiresAt} UTC:\n`);
console.log(`  ${baseUrl}/invite/${token}\n`);
