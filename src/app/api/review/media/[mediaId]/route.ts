import path from "path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { reviewMedia } from "@/db/schema";
import { serveFile } from "@grader/art-review/server";
import { apiRequireCapability } from "@/lib/auth/api";

/**
 * Range-served derivatives.
 *
 * Unlike /api/submissions/[id]/file, this streams and honours Range — Safari
 * (the iPad) will not play a video without it, and scrubbing a large file
 * without it is hopeless anywhere.
 */

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> },
) {
  return handle(request, params);
}

export async function HEAD(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> },
) {
  return handle(request, params);
}

async function handle(request: Request, params: Promise<{ mediaId: string }>) {
  const auth = await apiRequireCapability("course.view");
  if (!auth.user) return auth.response;

  const { mediaId } = await params;
  const id = Number(mediaId);
  if (!Number.isInteger(id)) return new Response("Bad id", { status: 400 });

  const rows = await db.select().from(reviewMedia).where(eq(reviewMedia.id, id));
  const media = rows[0];
  if (!media) return new Response("Not found", { status: 404 });

  const root = process.cwd();
  const absolute = path.resolve(root, media.path);
  // Paths come from our own ingest, but resolve-and-check anyway: a stored
  // path is still user-influenced data.
  if (!absolute.startsWith(path.join(root, "storage"))) {
    return new Response("Forbidden", { status: 403 });
  }

  return serveFile(request, absolute, {
    mime: media.mime,
    filename: path.basename(media.path),
    // Derivatives are regenerated under a new id, never mutated in place.
    immutable: true,
  });
}
