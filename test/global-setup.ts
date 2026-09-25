/**
 * Runs once before any test file. Builds a fresh scratch DB at the same
 * DB_PATH vitest.config.mts sets, via scripts/lib/migrations.mjs — the same
 * shared engine scripts/migrate.mjs and scripts/init-db.mjs use — so the
 * migration folder stays the single source of schema truth for tests too,
 * instead of a second hand-maintained schema. On an empty file every
 * migration's baseline probe is false, so this simply runs
 * drizzle/0000..0014 in order.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { migrate } from "../scripts/lib/migrations.mjs";

const TEST_DB_PATH = path.join(process.cwd(), "test", ".db", "vitest.db");

export default function setup() {
  const dir = path.dirname(TEST_DB_PATH);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  migrate(TEST_DB_PATH, { drizzleDir: path.join(process.cwd(), "drizzle") });
}
