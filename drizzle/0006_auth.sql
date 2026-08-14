-- Accounts: users, sessions, invites.
--
-- Applied by scripts/apply-auth-migration.mjs. Every statement is idempotent so
-- the script is safe to re-run; see that file for why the drizzle journal is not
-- the source of truth in this repo.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  net_id TEXT,
  name TEXT NOT NULL,
  password_hash TEXT,
  global_role TEXT NOT NULL DEFAULT 'instructor',
  status TEXT NOT NULL DEFAULT 'invited',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (email);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS users_net_id_idx ON users (net_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_agent TEXT,
  ip TEXT
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_idx ON sessions (token_hash);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  invited_by INTEGER REFERENCES users(id),
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS invites_token_idx ON invites (token_hash);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS invites_user_idx ON invites (user_id);
