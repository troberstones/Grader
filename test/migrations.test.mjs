// Exercises scripts/lib/migrations.mjs directly against scratch databases
// under test/.db — never storage/grader.db. Three things matter:
//
//   (a) A database built from nothing by the runner ends up with
//       rubric_levels.points nullable, and a share-model level with no
//       points can actually be inserted.
//   (b) A database built "the old way" — raw drizzle/0000-0013 SQL plus the
//       legacy apply-rubric-share-model-migration.mjs script, exactly what
//       production looked like before this runner existed — gets baselined
//       correctly: everything already there is recorded without re-running,
//       except the two migrations that are always executed for real rather
//       than baseline-skipped (0003 and 0014 — see ALWAYS_APPLY_ON_BASELINE
//       in scripts/lib/migrations.mjs), which land as safe no-ops. Running
//       the runner again afterwards is a complete no-op.
//   (c) The two databases end up with identical schemas, so "fresh" and
//       "migrated production" really do mean the same thing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import { listMigrationFiles, migrate, splitStatements } from "../scripts/lib/migrations.mjs";

const drizzleDir = path.join(process.cwd(), "drizzle");
const scratchDir = path.join(process.cwd(), "test", ".db");
const freshDbPath = path.join(scratchDir, "migrate-fresh.db");
const legacyDbPath = path.join(scratchDir, "migrate-legacy.db");
const legacyRubricShareScript = path.join(
  process.cwd(),
  "scripts",
  "legacy-migrations",
  "apply-rubric-share-model-migration.mjs",
);

function resetDb(dbPath) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = dbPath + suffix;
    if (existsSync(file)) rmSync(file);
  }
}

function tableNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
}

function indexList(db) {
  return db
    .prepare("SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();
}

function columnInfo(db, table, column) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .find((c) => c.name === column);
}

test("fresh database via the runner: rubric_levels.points is nullable and accepts a share-rubric level", () => {
  resetDb(freshDbPath);
  migrate(freshDbPath, { drizzleDir });

  const db = new Database(freshDbPath);
  try {
    const points = columnInfo(db, "rubric_levels", "points");
    assert.equal(points.notnull, 0, "rubric_levels.points should be nullable");

    const rubricId = db.prepare("INSERT INTO rubrics (name) VALUES ('Share model rubric')").run().lastInsertRowid;
    const criteriaId = db
      .prepare("INSERT INTO rubric_criteria (rubric_id, name, sort_order) VALUES (?, 'Composition', 0)")
      .run(rubricId).lastInsertRowid;

    assert.doesNotThrow(() => {
      db.prepare(
        "INSERT INTO rubric_levels (criteria_id, level, label, description, points) VALUES (?, 0, 'Level 0', 'desc', NULL)",
      ).run(criteriaId);
    }, "inserting a share-model level with null points should not throw a NOT NULL constraint error");
  } finally {
    db.close();
  }
});

test("baselining a database built the old way applies only what it must, and a second run is a no-op", () => {
  resetDb(legacyDbPath);

  // Build the database the way production actually got here: raw
  // drizzle/0000-0013 SQL (no 0014 — it didn't exist yet), replayed the same
  // way test/global-setup.ts and scripts/init-db.mjs used to do it by hand.
  const preMigrationFiles = listMigrationFiles(drizzleDir).filter((f) => !f.startsWith("0014"));
  const db = new Database(legacyDbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  for (const file of preMigrationFiles) {
    const sql = readFileSync(path.join(drizzleDir, file), "utf8");
    for (const statement of splitStatements(sql)) db.exec(statement);
  }
  db.close();

  // Then the legacy applier that never got a paired drizzle/*.sql file.
  execFileSync(process.execPath, [legacyRubricShareScript], {
    env: { ...process.env, DB_PATH: legacyDbPath },
    stdio: "pipe",
  });

  const firstPlan = migrate(legacyDbPath, { drizzleDir });
  const applied = firstPlan.filter((p) => p.action === "apply").map((p) => p.file);
  const baselined = firstPlan.filter((p) => p.action === "skip-baseline").map((p) => p.file);

  // 0014 always actually runs during baselining (see ALWAYS_APPLY_ON_BASELINE
  // in scripts/lib/migrations.mjs) — its effect here came entirely from the
  // legacy script, which is indistinguishable from 0014 itself having run.
  // 0003 (`DROP INDEX IF EXISTS`) is in the same set for a different reason:
  // it's self-idempotent, and its own artifact is an *absence*, which can't
  // be probed reliably up front (see the module comment). Both are safe
  // no-ops here since the database already reflects their effect.
  assert.deepEqual(applied, ["0003_drop_submission_unique.sql", "0014_rubric_share_model.sql"]);
  assert.deepEqual(
    baselined,
    preMigrationFiles.filter((f) => f !== "0003_drop_submission_unique.sql"),
    "every other pre-existing migration should be baselined, not re-run",
  );

  const secondPlan = migrate(legacyDbPath, { drizzleDir });
  assert.ok(
    secondPlan.every((p) => p.action === "skip-tracked"),
    "a second run against an already-migrated database should be a complete no-op",
  );
});

test("a runner-built fresh database and a baselined legacy database have identical schemas", () => {
  assert.ok(existsSync(freshDbPath), "run the fresh-database test first");
  assert.ok(existsSync(legacyDbPath), "run the baseline test first");

  const dbA = new Database(freshDbPath);
  const dbB = new Database(legacyDbPath);
  try {
    const tablesA = tableNames(dbA);
    const tablesB = tableNames(dbB);
    assert.deepEqual(tablesA, tablesB, "table lists should match");

    for (const table of tablesA) {
      assert.deepEqual(
        dbA.prepare(`PRAGMA table_info(${table})`).all(),
        dbB.prepare(`PRAGMA table_info(${table})`).all(),
        `PRAGMA table_info(${table}) should match`,
      );
    }

    assert.deepEqual(indexList(dbA), indexList(dbB), "index lists should match");
  } finally {
    dbA.close();
    dbB.close();
  }
});
