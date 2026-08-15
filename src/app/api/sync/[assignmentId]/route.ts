import { NextRequest, NextResponse } from "next/server";
import { apiRequireCapability } from "@/lib/auth/api";

export const dynamic = "force-dynamic";

// Module-level in-memory listener registry. Keyed by assignmentId string.
// Each value is a Set of active SSE stream controllers for that assignment.
const listeners = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();

const encoder = new TextEncoder();

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  const auth = await apiRequireCapability("course.view");
  if (!auth.user) return auth.response;

  const { assignmentId } = await params;

  // Capture the controller so the cancel callback can remove it.
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller;
      if (!listeners.has(assignmentId)) {
        listeners.set(assignmentId, new Set());
      }
      listeners.get(assignmentId)!.add(controller);
      // SSE requires at least one byte to flush the response headers immediately.
      controller.enqueue(encoder.encode(": keepalive\n\n"));
    },
    cancel() {
      const set = listeners.get(assignmentId);
      if (set) {
        set.delete(ctrl);
        if (set.size === 0) listeners.delete(assignmentId);
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  const auth = await apiRequireCapability("course.view");
  if (!auth.user) return auth.response;

  const { assignmentId } = await params;
  const body = (await req.json()) as { studentId: number; sender: string };

  const set = listeners.get(assignmentId);
  if (set && set.size > 0) {
    const message = encoder.encode(`data: ${JSON.stringify(body)}\n\n`);
    for (const controller of [...set]) {
      try {
        controller.enqueue(message);
      } catch {
        // Controller is closed — remove it.
        set.delete(controller);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
