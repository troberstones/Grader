import { NextRequest, NextResponse } from "next/server";
import { apiRequireCapability } from "@/lib/auth/api";
import { submissionResource } from "@/lib/auth/resource-lookup";
import { subscribeIngestProgress } from "@/lib/ingest-progress";

export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

/**
 * SSE stream of ingest progress for one submission — subscribed to right
 * after upload, while the video transcode that ensureIngested() kicks off
 * (see src/actions/review.ts) is still running. Stays open until the client
 * closes it (once its own listReviewItems() call resolves); a submission
 * that's already ingested, or fails before publishing anything, just idles
 * the connection rather than ending the stream from here, since there's no
 * single progress event that reliably means "done" — the proxy step reaches
 * 100% before the thumbnail step even starts.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> },
) {
  const { submissionId } = await params;
  const id = Number(submissionId);
  const resource = await submissionResource(id);
  const auth = await apiRequireCapability("roster.view", resource);
  if (!auth.user) return auth.response;

  let unsubscribe!: () => void;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(": keepalive\n\n"));
      unsubscribe = subscribeIngestProgress(id, (stage, pct) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ stage, pct })}\n\n`));
        } catch {
          // controller already closed
        }
      });
    },
    cancel() {
      unsubscribe();
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
