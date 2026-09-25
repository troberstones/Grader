/**
 * GET /api/health — unauthenticated liveness/readiness check for the deploy
 * script's post-restart health check and any external monitoring. Confirms
 * the two ways the app can be "up" but unusable: the database file is
 * unreadable/locked, or the disk it (and uploads) live on is nearly full.
 *
 * Deliberately returns nothing beyond ok/not-ok — no paths, versions, row
 * counts, or error text — since this endpoint has no auth in front of it.
 * Details go to the server log instead, for whoever reads it.
 */

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { statfs } from "node:fs/promises";
import path from "node:path";

import { db } from "@/db";

// Matches src/db/index.ts's own DB_PATH default, so the disk check looks at
// the same volume the database (and, being under the same storage/ tree,
// submissions/thumbnails/backups) actually lives on.
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "storage", "grader.db");
const STORAGE_DIR = path.dirname(DB_PATH);

const MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

// Never cache a health check — every hit should reflect the current state.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    db.run(sql`select 1`);

    const stats = await statfs(STORAGE_DIR);
    const freeBytes = stats.bavail * stats.bsize;
    if (freeBytes < MIN_FREE_BYTES) {
      throw new Error(`low disk space on ${STORAGE_DIR}: ${freeBytes} bytes free`);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[health] check failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
