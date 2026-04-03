import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { assignments } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  const { assignmentId } = await params;
  const id = Number(assignmentId);
  if (!id) return NextResponse.json({ error: "Invalid assignmentId" }, { status: 400 });

  const { lmsDiscussionUrl } = await request.json() as { lmsDiscussionUrl: string | null };

  await db
    .update(assignments)
    .set({ lmsDiscussionUrl: lmsDiscussionUrl ?? null, updatedAt: new Date().toISOString() })
    .where(eq(assignments.id, id));

  return NextResponse.json({ ok: true });
}
