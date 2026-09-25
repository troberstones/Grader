#!/usr/bin/env node
/**
 * The one migration runner for this repo. Applies every drizzle/NNNN_*.sql
 * file that hasn't run yet, in numeric order, recording each in a
 * `schema_migrations` table. See scripts/lib/migrations.mjs for exactly how
 * it decides what "hasn't run yet" means on a database that predates that
 * table (baselining) versus one that's already tracked.
 *
 *   node scripts/migrate.mjs              # apply pending migrations
 *   node scripts/migrate.mjs --dry-run    # print the plan, change nothing
 *   npm run db:migrate
 *   npm run db:migrate -- --dry-run
 *   DB_PATH=path/to.db node scripts/migrate.mjs
 */
import path from "node:path";
import { migrate } from "./lib/migrations.mjs";

const dbPath = process.env.DB_PATH || path.join(process.cwd(), "storage", "grader.db");
const dryRun = process.argv.includes("--dry-run");

const plan = migrate(dbPath, { dryRun });

const pending = plan.filter((p) => p.action === "apply").length;
if (dryRun) {
  console.log(pending === 0 ? "Up to date — nothing would run." : `${pending} migration(s) would run.`);
} else {
  console.log(pending === 0 ? `${dbPath} is up to date.` : `Applied ${pending} migration(s) to ${dbPath}.`);
}
