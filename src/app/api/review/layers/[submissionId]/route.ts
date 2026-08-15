import path from "path";
import fs from "fs/promises";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { reviewMedia } from "@/db/schema";
import { apiRequireCapability } from "@/lib/auth/api";

/**
 * PSD layer manifest.
 *
 * Ingest writes filesystem paths into the manifest because it has no idea what
 * a URL looks like; this route swaps them for /api/review/media ids on the way
 * out, so the module stays free of any knowledge of grader's routing.
 */

export const dynamic = "force-dynamic";

interface Manifest {
  layers: { rasterUrl: string | null }[];
  compositeUrl: string;
  [key: string]: unknown;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ submissionId: string }> },
) {
  const auth = await apiRequireCapability("course.view");
  if (!auth.user) return auth.response;

  const { submissionId } = await params;
  const id = Number(submissionId);
  if (!Number.isInteger(id)) return new Response("Bad id", { status: 400 });

  const media = await db
    .select()
    .from(reviewMedia)
    .where(eq(reviewMedia.submissionId, id));

  const manifestRow = media.find((m) => m.variant === "page" && m.idx === -1);
  if (!manifestRow) return new Response("Not found", { status: 404 });

  const root = process.cwd();
  const absolute = path.resolve(root, manifestRow.path);
  if (!absolute.startsWith(path.join(root, "storage"))) {
    return new Response("Forbidden", { status: 403 });
  }

  let manifest: Manifest;
  try {
    manifest = JSON.parse(await fs.readFile(absolute, "utf8")) as Manifest;
  } catch {
    return new Response("Manifest unreadable", { status: 500 });
  }

  // path-on-disk → media id
  const byPath = new Map<string, number>();
  for (const m of media) byPath.set(path.resolve(root, m.path), m.id);

  const toUrl = (p: string | null): string | null => {
    if (!p) return null;
    const mediaId = byPath.get(path.resolve(root, p));
    return mediaId ? `/api/review/media/${mediaId}` : null;
  };

  manifest.layers = manifest.layers.map((l) => ({ ...l, rasterUrl: toUrl(l.rasterUrl) }));
  manifest.compositeUrl = toUrl(manifest.compositeUrl) ?? manifest.compositeUrl;

  return Response.json(manifest, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
