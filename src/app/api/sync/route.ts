import { NextResponse } from "next/server";
import { apiRequireCapability } from "@/lib/auth/api";

export const dynamic = "force-dynamic";

// Module-level listener set — shared across all SSE connections in the same process.
const listeners = new Set<ReadableStreamDefaultController<Uint8Array>>();
const encoder = new TextEncoder();

export async function GET() {
  const auth = await apiRequireCapability("course.view");
  if (!auth.user) return auth.response;

  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller;
      listeners.add(controller);
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

export async function POST(req: Request) {
  const auth = await apiRequireCapability("course.view");
  if (!auth.user) return auth.response;

  const body = await req.json();
  const message = encoder.encode(`data: ${JSON.stringify(body)}\n\n`);
  for (const controller of [...listeners]) {
    try {
      controller.enqueue(message);
    } catch {
      listeners.delete(controller);
    }
  }
  return NextResponse.json({ ok: true });
}
