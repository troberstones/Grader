import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

/**
 * HTTP Range-aware file serving.
 *
 * Safari — i.e. the iPad — will not play a video at all without byte-range
 * support, and scrubbing a large file without it is hopeless anywhere. Reading
 * the whole file into a Buffer (as grader's existing submission route does)
 * also pins the entire file in memory per request.
 */
export async function serveFile(
  request: Request,
  absolutePath: string,
  options: {
    mime: string;
    filename?: string;
    /** Derivatives are content-addressed and safe to cache hard. */
    immutable?: boolean;
    maxAge?: number;
  },
): Promise<Response> {
  let info;
  try {
    info = await stat(absolutePath);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!info.isFile()) return new Response("Not found", { status: 404 });

  const size = info.size;
  const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  const cache = options.immutable
    ? "private, max-age=31536000, immutable"
    : `private, max-age=${options.maxAge ?? 3600}`;

  const baseHeaders: Record<string, string> = {
    "Content-Type": options.mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": cache,
    ETag: etag,
    "Last-Modified": new Date(info.mtimeMs).toUTCString(),
  };
  if (options.filename) {
    baseHeaders["Content-Disposition"] = `inline; filename="${sanitise(options.filename)}"`;
  }

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: baseHeaders });
  }

  const rangeHeader = request.headers.get("range");
  if (!rangeHeader) {
    if (request.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: { ...baseHeaders, "Content-Length": String(size) },
      });
    }
    return new Response(toWeb(createReadStream(absolutePath)), {
      status: 200,
      headers: { ...baseHeaders, "Content-Length": String(size) },
    });
  }

  const parsed = parseRange(rangeHeader, size);
  if (!parsed) {
    return new Response("Range not satisfiable", {
      status: 416,
      headers: { ...baseHeaders, "Content-Range": `bytes */${size}` },
    });
  }

  const { start, end } = parsed;
  return new Response(toWeb(createReadStream(absolutePath, { start, end })), {
    status: 206,
    headers: {
      ...baseHeaders,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
    },
  });
}

/** Single range only — that is all any browser media element asks for. */
function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;

  if (rawStart === "" && rawEnd === "") return null;

  let start: number;
  let end: number;
  if (rawStart === "") {
    // Suffix range: last N bytes.
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Number(rawEnd);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

function toWeb(stream: Readable): ReadableStream<Uint8Array> {
  return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
}

function sanitise(name: string): string {
  return name.replace(/[^\w.\- ]+/g, "_");
}
