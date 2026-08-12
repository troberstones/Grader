"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serveFile = serveFile;
const node_fs_1 = require("node:fs");
const promises_1 = require("node:fs/promises");
const node_stream_1 = require("node:stream");
/**
 * HTTP Range-aware file serving.
 *
 * Safari — i.e. the iPad — will not play a video at all without byte-range
 * support, and scrubbing a large file without it is hopeless anywhere. Reading
 * the whole file into a Buffer (as grader's existing submission route does)
 * also pins the entire file in memory per request.
 */
async function serveFile(request, absolutePath, options) {
    let info;
    try {
        info = await (0, promises_1.stat)(absolutePath);
    }
    catch {
        return new Response("Not found", { status: 404 });
    }
    if (!info.isFile())
        return new Response("Not found", { status: 404 });
    const size = info.size;
    const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    const cache = options.immutable
        ? "private, max-age=31536000, immutable"
        : `private, max-age=${options.maxAge ?? 3600}`;
    const baseHeaders = {
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
        return new Response(toWeb((0, node_fs_1.createReadStream)(absolutePath)), {
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
    return new Response(toWeb((0, node_fs_1.createReadStream)(absolutePath, { start, end })), {
        status: 206,
        headers: {
            ...baseHeaders,
            "Content-Range": `bytes ${start}-${end}/${size}`,
            "Content-Length": String(end - start + 1),
        },
    });
}
/** Single range only — that is all any browser media element asks for. */
function parseRange(header, size) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match)
        return null;
    const [, rawStart, rawEnd] = match;
    if (rawStart === "" && rawEnd === "")
        return null;
    let start;
    let end;
    if (rawStart === "") {
        // Suffix range: last N bytes.
        const suffix = Number(rawEnd);
        if (!Number.isFinite(suffix) || suffix <= 0)
            return null;
        start = Math.max(0, size - suffix);
        end = size - 1;
    }
    else {
        start = Number(rawStart);
        end = rawEnd === "" ? size - 1 : Number(rawEnd);
    }
    if (!Number.isFinite(start) || !Number.isFinite(end))
        return null;
    if (start > end || start >= size)
        return null;
    return { start, end: Math.min(end, size - 1) };
}
function toWeb(stream) {
    return node_stream_1.Readable.toWeb(stream);
}
function sanitise(name) {
    return name.replace(/[^\w.\- ]+/g, "_");
}
