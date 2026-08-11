"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.classify = classify;
exports.probe = probe;
exports.makeVideoProxy = makeVideoProxy;
exports.makePoster = makePoster;
exports.normaliseImage = normaliseImage;
exports.ingestFile = ingestFile;
const node_child_process_1 = require("node:child_process");
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const node_util_1 = require("node:util");
const run = (0, node_util_1.promisify)(node_child_process_1.execFile);
const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv", ".mpg", ".mpeg"]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
const CONVERT_EXT = new Set([".tif", ".tiff", ".exr", ".dpx", ".tga"]);
function classify(fileName) {
    const ext = node_path_1.default.extname(fileName).toLowerCase();
    if (VIDEO_EXT.has(ext))
        return "video";
    if (IMAGE_EXT.has(ext))
        return "image";
    if (CONVERT_EXT.has(ext))
        return "convert";
    if (ext === ".psd" || ext === ".psb")
        return "psd";
    if (ext === ".pdf")
        return "pdf";
    return null;
}
async function probe(input, ffprobePath = "ffprobe") {
    const { stdout } = await run(ffprobePath, [
        "-v", "error",
        "-show_entries",
        "stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames,duration,pix_fmt,color_primaries,color_transfer",
        "-show_entries", "format=duration",
        "-of", "json",
        input,
    ], { maxBuffer: 8 * 1024 * 1024 });
    const data = JSON.parse(stdout);
    const streams = data.streams ?? [];
    const v = streams.find((s) => s.codec_type === "video");
    if (!v)
        throw new Error("no video stream");
    const fps = parseRate(String(v.avg_frame_rate ?? "")) || parseRate(String(v.r_frame_rate ?? "")) || 24;
    const duration = Number(v.duration) || Number(data.format?.duration) || 0;
    // nb_frames is missing from plenty of containers; derive it rather than
    // decoding the whole file with -count_frames.
    let frameCount = Number(v.nb_frames) || 0;
    if (!frameCount && duration && fps)
        frameCount = Math.round(duration * fps);
    return {
        width: Number(v.width) || 0,
        height: Number(v.height) || 0,
        fps,
        frameCount: Math.max(1, frameCount),
        duration,
        codec: String(v.codec_name ?? ""),
        pixFmt: String(v.pix_fmt ?? ""),
        colorPrimaries: v.color_primaries ? String(v.color_primaries) : undefined,
        colorTransfer: v.color_transfer ? String(v.color_transfer) : undefined,
        hasAudio: streams.some((s) => s.codec_type === "audio"),
    };
}
function parseRate(r) {
    const [num, den] = r.split("/").map(Number);
    if (!num || !den)
        return 0;
    const v = num / den;
    return Number.isFinite(v) && v > 0 && v < 1000 ? v : 0;
}
async function exists(p) {
    try {
        await (0, promises_1.stat)(p);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Transcode to an all-intra H.264 proxy.
 *
 * `-g 1` makes every frame a keyframe: decoding frame 87 no longer walks a GOP
 * from frame 60, reverse decode stops being a special case, and the <video>
 * fallback can seek exactly. Bitrate roughly quadruples, which is nothing on a
 * studio LAN and is why the original is always kept alongside.
 */
async function makeVideoProxy(input, opts) {
    const ffmpeg = opts.ffmpegPath ?? "ffmpeg";
    await (0, promises_1.mkdir)(opts.outDir, { recursive: true });
    const out = node_path_1.default.join(opts.outDir, `${opts.baseName}.proxy.mp4`);
    const info = opts.probe ?? (await probe(input, opts.ffprobePath));
    const maxWidth = opts.maxWidth ?? 1920;
    if (!opts.force && (await exists(out))) {
        return proxyDerivative(out, info, maxWidth);
    }
    const args = [
        "-y",
        "-i", input,
        "-map", "0:v:0",
        "-c:v", "libx264",
        "-crf", "18",
        "-preset", "fast",
        "-pix_fmt", "yuv420p",
        "-vf", `scale='min(${maxWidth},iw)':-2:flags=lanczos`,
        "-movflags", "+faststart",
    ];
    if (opts.allIntra !== false)
        args.push("-g", "1", "-bf", "0");
    if (info.hasAudio)
        args.push("-map", "0:a:0?", "-c:a", "aac", "-b:a", "160k");
    else
        args.push("-an");
    args.push(out);
    await run(ffmpeg, args, { maxBuffer: 16 * 1024 * 1024 });
    return proxyDerivative(out, info, maxWidth);
}
function proxyDerivative(out, info, maxWidth) {
    const scale = Math.min(1, maxWidth / Math.max(1, info.width));
    const w = Math.round(info.width * scale);
    return {
        variant: "proxy",
        idx: 0,
        path: out,
        mime: "video/mp4",
        // -2 keeps height even; mirror that so stored dimensions match the file.
        width: w - (w % 2),
        height: Math.round(info.height * scale) - (Math.round(info.height * scale) % 2),
        fps: info.fps,
        frameCount: info.frameCount,
        duration: info.duration,
        colorPrimaries: info.colorPrimaries,
        colorTransfer: info.colorTransfer,
    };
}
async function makePoster(input, opts) {
    const ffmpeg = opts.ffmpegPath ?? "ffmpeg";
    await (0, promises_1.mkdir)(opts.outDir, { recursive: true });
    const out = node_path_1.default.join(opts.outDir, `${opts.baseName}.poster.jpg`);
    if (!opts.force && (await exists(out))) {
        return { variant: "poster", idx: 0, path: out, mime: "image/jpeg" };
    }
    try {
        await run(ffmpeg, [
            "-y", "-i", input,
            "-frames:v", "1",
            "-vf", "scale='min(640,iw)':-2",
            "-q:v", "4",
            out,
        ]);
        return { variant: "poster", idx: 0, path: out, mime: "image/jpeg" };
    }
    catch {
        return null;
    }
}
/**
 * Normalise a still image.
 *
 * Matrix/TRC ICC profiles (sRGB, AdobeRGB, Display P3, ProPhoto — nearly every
 * RGB working space) could be applied in the shader, but converting once at
 * ingest is simpler and covers LUT-based profiles too, which cannot go in a
 * shader at all. The original is always kept.
 */
async function normaliseImage(input, opts) {
    const sharp = (await Promise.resolve().then(() => __importStar(require("sharp")))).default;
    await (0, promises_1.mkdir)(opts.outDir, { recursive: true });
    const out = node_path_1.default.join(opts.outDir, `${opts.baseName}.view.png`);
    const image = sharp(input, { limitInputPixels: 1_000_000_000, unlimited: true });
    const meta = await image.metadata();
    if (!opts.force && (await exists(out))) {
        return {
            variant: "composite",
            idx: 0,
            path: out,
            mime: "image/png",
            width: meta.width,
            height: meta.height,
        };
    }
    const maxWidth = opts.maxWidth ?? 4096;
    let pipeline = image;
    if (meta.icc)
        pipeline = pipeline.toColourspace("srgb");
    if ((meta.width ?? 0) > maxWidth)
        pipeline = pipeline.resize({ width: maxWidth });
    const info = await pipeline.png({ compressionLevel: 6 }).toFile(out);
    return {
        variant: "composite",
        idx: 0,
        path: out,
        mime: "image/png",
        width: info.width,
        height: info.height,
    };
}
async function ingestFile(input, fileName, opts) {
    const warnings = [];
    const kind = classify(fileName);
    if (kind === "video") {
        const info = await probe(input, opts.ffprobePath);
        const proxy = await makeVideoProxy(input, { ...opts, probe: info });
        const poster = await makePoster(input, opts);
        return {
            kind: "video",
            derivatives: poster ? [proxy, poster] : [proxy],
            width: proxy.width ?? info.width,
            height: proxy.height ?? info.height,
            frameCount: info.frameCount,
            fps: info.fps,
            duration: info.duration,
            warnings,
        };
    }
    if (kind === "psd") {
        const { ingestPsd } = await Promise.resolve().then(() => __importStar(require("./psd")));
        return ingestPsd(input, opts);
    }
    if (kind === "pdf") {
        // No poppler/ghostscript/ImageMagick on this machine, so pages are
        // rasterised client-side by pdf.js instead. Page count comes from the file.
        const { pdfPageCount } = await Promise.resolve().then(() => __importStar(require("./pdf")));
        const pages = await pdfPageCount(input).catch(() => 1);
        return {
            kind: "pages",
            derivatives: [],
            width: 1275,
            height: 1650,
            frameCount: pages,
            fps: null,
            duration: null,
            warnings: ["PDF pages render in the browser; dimensions are per-page"],
        };
    }
    if (kind === "image" || kind === "convert") {
        const view = await normaliseImage(input, opts);
        return {
            kind: "still",
            derivatives: [view],
            width: view.width ?? 0,
            height: view.height ?? 0,
            frameCount: 1,
            fps: null,
            duration: null,
            warnings,
        };
    }
    throw new Error(`unsupported file type: ${fileName}`);
}
