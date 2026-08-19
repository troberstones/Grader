import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assignments } from "@/db/schema";
import { apiRequireCapability } from "@/lib/auth/api";
import { resolveAuthContext } from "@/lib/auth/course-context";
import { can } from "@/lib/auth/roles";
import type { SessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Global sync bus — every connected tab, any course.
 *
 * Connecting only requires being an active instructor/assistant (unchanged);
 * a long-lived SSE connection can't know in advance every course it'll need,
 * so per-course access is enforced per broadcast instead, in POST below. Every
 * listener carries the user that opened it so fan-out can filter by their
 * real course_members role, via the same roster.view capability the rest of
 * the app uses for real per-student content — see docs/security.md.
 */
const listeners = new Map<ReadableStreamDefaultController<Uint8Array>, SessionUser>();
const encoder = new TextEncoder();

export async function GET() {
  const auth = await apiRequireCapability("course.view");
  if (!auth.user) return auth.response;

  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller;
      listeners.set(controller, auth.user);
      controller.enqueue(encoder.encode(": keepalive\n\n"));
    },
    cancel() {
      listeners.delete(ctrl);
    },
  });
  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Every `GlobalSyncPayload` variant (navigate/playback/annotation-saved/
 * playback-master — see global-sync.tsx) carries `assignmentId` directly.
 * Art-review actions piggybacked by useReviewChannel (review-channel.ts)
 * instead carry `ctx: "assignment:{id}:student:{id}"`.
 */
function resolveAssignmentId(body: Record<string, unknown>): number | null {
  if (typeof body.assignmentId === "number") return body.assignmentId;
  if (typeof body.ctx === "string") {
    const m = /^assignment:(\d+):student:(\d+)$/.exec(body.ctx);
    if (m) return Number(m[1]);
  }
  return null;
}

export async function POST(req: Request) {
  const auth = await apiRequireCapability("course.view");
  if (!auth.user) return auth.response;

  const body = (await req.json()) as Record<string, unknown>;
  const assignmentId = resolveAssignmentId(body);

  // Nothing to check a course against — drop rather than broadcast unfiltered.
  if (assignmentId === null) return NextResponse.json({ ok: true });

  const [row] = await db
    .select({ courseId: assignments.courseId })
    .from(assignments)
    .where(eq(assignments.id, assignmentId));
  if (!row) return NextResponse.json({ ok: true });
  const courseId = row.courseId;

  const message = encoder.encode(`data: ${JSON.stringify(body)}\n\n`);
  for (const [controller, user] of [...listeners]) {
    const ctx = await resolveAuthContext({ kind: "course", courseId }, user.id);
    if (!can(user, "roster.view", { kind: "course", courseId }, ctx)) continue;
    try {
      controller.enqueue(message);
    } catch {
      listeners.delete(controller);
    }
  }
  return NextResponse.json({ ok: true });
}
