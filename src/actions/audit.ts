"use server";

import { desc, lt } from "drizzle-orm";

import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/session";

export interface AuditLogRow {
  id: number;
  actorEmail: string;
  action: string;
  targetType: string | null;
  targetId: number | null;
  detail: string | null;
  ip: string | null;
  createdAt: string;
}

const PAGE_SIZE = 100;

/** Newest first, cursor-paginated by id. Admin-only — this is the whole point of the log. */
export async function listAuditLog(beforeId?: number): Promise<AuditLogRow[]> {
  await requireAdmin();
  return db
    .select()
    .from(auditLog)
    .where(beforeId ? lt(auditLog.id, beforeId) : undefined)
    .orderBy(desc(auditLog.id))
    .limit(PAGE_SIZE);
}
