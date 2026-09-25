#!/usr/bin/env node
/**
 * Builds a fresh database from nothing — the one thing this repo didn't
 * have a documented, single-command way to do. Thin wrapper around
 * scripts/lib/migrations.mjs: on a database with nothing in it, every
 * migration's baseline probe comes back false, so this runs every
 * drizzle/NNNN_*.sql file in order, exactly like a from-scratch production
 * baseline would.
 *
 * Safe to run against a database that already has a schema — anything
 * already applied is detected and skipped rather than re-run.
 *
 *   node scripts/init-db.mjs
 *   DB_PATH=... node scripts/init-db.mjs
 */
import path from "node:path";
import { migrate } from "./lib/migrations.mjs";

const dbPath = process.env.DB_PATH || path.join(process.cwd(), "storage", "grader.db");

const plan = migrate(dbPath);
const applied = plan.filter((p) => p.action === "apply").length;

if (applied === 0) {
  console.log(`${dbPath} already has a schema — nothing to do.`);
} else {
  console.log(`Initialized ${dbPath} — applied ${applied} migration(s).`);
  console.log("Run `npm run dev` and open /setup to create the first administrator.");
}
