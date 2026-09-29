import { execFile, spawn } from "node:child_process";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Derivative, IngestOptions, ProbeResult } from "./ingest";

const run = promisify(execFile);

/**
 * Slideshow videos: a handful of stills, each held for seconds, exported as
 * an .mp4 because that's what the assignment asked for. Played as video they
 * cost hundreds of identical frames — to step through in the reviewer, to
 * cache as decoded bitmaps, and to draw on (a note on frame 140 vanishes at
 * frame 150 on the same image). Ingest turns them into a short sequence of
 * just the distinct images instead.
 */
export const SLIDESHOW = {
  /** More held images than this and it's an animation, whatever the holds. */
  maxSlides: 200,
  /** Frames an image must stay unchanged to count as a slide rather than a transition. */
  minHold: 5,
  /** Share of the video the held images must cover; the rest is fades and cuts. */
  minCoverage: 0.5,
  /** This much unbroken motion means it's an animation — stop decoding. */
  maxMotionSeconds: 2,
  /** A slideshow with a louder soundtrack than this stays a video — the audio would be lost. */
  silentDb: -50,
  /** Played back at this rate; the reviewer's fps control goes no lower. */
  fps: 1,
};

/** One held image: the source frame it appears on and how many frames it stays. */
export interface Slide {
  start: number;
  hold: number;
}

/**
 * The held images of a slideshow video, or null when it isn't one. One
 * decode pass (about a second for a minute of 1080p), cut short after
 * `maxMotionSeconds` of continuous change, so a real animation pays for a
 * couple of seconds of decoding and no more.
 */
export async function detectSlideshow(
  input: string,
  info: ProbeResult,
  ffmpeg = "ffmpeg",
): Promise<Slide[] | null> {
  if (info.frameCount < SLIDESHOW.minHold * 2) return null;
  if (info.hasAudio && !(await isSilent(input, ffmpeg))) return null;

  const maxRun = Math.max(48, Math.round(SLIDESHOW.maxMotionSeconds * (info.fps || 24)));
  const starts = await distinctFrameStarts(input, maxRun, ffmpeg);
  if (!starts) return null;
  return slidesFrom(starts, info.frameCount);
}

/**
 * Keeps the images that stay on screen; the frames of a crossfade each count
 * as "distinct" but are held for one frame, so they drop out here.
 */
export function slidesFrom(starts: number[], frameCount: number): Slide[] | null {
  const slides: Slide[] = [];
  for (let i = 0; i < starts.length; i++) {
    const hold = (i + 1 < starts.length ? starts[i + 1] : frameCount) - starts[i];
    if (hold >= SLIDESHOW.minHold) slides.push({ start: starts[i], hold });
  }
  const covered = slides.reduce((n, s) => n + s.hold, 0);
  if (slides.length < 2 || slides.length > SLIDESHOW.maxSlides) return null;
  if (covered < frameCount * SLIDESHOW.minCoverage) return null;
  return slides;
}

async function isSilent(input: string, ffmpeg: string): Promise<boolean> {
  try {
    const { stderr } = await run(ffmpeg, ["-hide_banner", "-nostats", "-i", input, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"], {
      maxBuffer: 8 * 1024 * 1024,
    });
    const max = /max_volume:\s*(-?[\d.]+|-inf) dB/.exec(stderr)?.[1];
    if (max === undefined) return false;
    return max === "-inf" || Number(max) <= SLIDESHOW.silentDb;
  } catch {
    // Undecodable audio: don't risk throwing away something audible.
    return false;
  }
}

/**
 * `setpts=N` stamps every frame with its decode index before mpdecimate
 * drops the repeats, so showinfo's `pts:` is the source frame number — no
 * timestamp arithmetic to go wrong on variable-frame-rate files. Thresholds
 * are stricter than mpdecimate's defaults: a slow pan kept as frames is only
 * a missed optimisation, a pan collapsed to one still would lose the work.
 */
function distinctFrameStarts(input: string, maxRun: number, ffmpeg: string): Promise<number[] | null> {
  return new Promise((resolve) => {
    const child = spawn(ffmpeg, [
      "-hide_banner", "-nostats",
      "-i", input,
      "-map", "0:v:0",
      "-vf", "setpts=N,mpdecimate=hi=256:lo=128:frac=0.1,showinfo",
      "-f", "null", "-",
    ]);
    const starts: number[] = [];
    let run = 0;
    let buffered = "";
    let settled = false;
    const finish = (v: number[] | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    child.stderr.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        const m = /Parsed_showinfo.*\bpts:\s*(\d+)/.exec(line);
        if (!m) continue;
        const n = Number(m[1]);
        run = starts.length > 0 && n === starts[starts.length - 1] + 1 ? run + 1 : 0;
        starts.push(n);
        if (run > maxRun) {
          child.kill("SIGKILL");
          finish(null);
          return;
        }
      }
    });
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code === 0 ? starts : null));
  });
}

/**
 * One still per slide, taken from the middle of its hold rather than its
 * first frame, in case the change settled over a frame or two.
 * Written as high-quality JPEG: the source is already lossy H.264, so PNG
 * would be several times the bytes for no visible gain. Rendered into a
 * private temp directory and renamed into place, so a concurrent ingest of
 * the same file can never leave a mix of two runs' frames.
 */
export async function extractSlides(
  input: string,
  slides: Slide[],
  info: ProbeResult,
  opts: IngestOptions,
): Promise<Derivative[]> {
  const ffmpeg = opts.ffmpegPath ?? "ffmpeg";
  const maxWidth = opts.maxWidth ?? 1920;
  const picks = slides.map((s) => s.start + Math.floor((s.hold - 1) / 2));

  await mkdir(opts.outDir, { recursive: true });
  const tmp = path.join(opts.outDir, `.${opts.baseName}.slides-${process.pid}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tmp);
  try {
    opts.onProgress?.("Extracting slides");
    await run(ffmpeg, [
      "-y", "-hide_banner", "-nostats",
      "-i", input,
      "-map", "0:v:0",
      "-vf", `select='${picks.map((n) => `eq(n\\,${n})`).join("+")}',scale='min(${maxWidth},iw)':-2:flags=lanczos`,
      "-fps_mode", "passthrough",
      "-q:v", "2",
      path.join(tmp, "%04d.jpg"),
    ], { maxBuffer: 16 * 1024 * 1024 });

    const written = (await readdir(tmp)).filter((f) => f.endsWith(".jpg")).sort();
    if (written.length !== picks.length) {
      throw new Error(`expected ${picks.length} slides, got ${written.length}`);
    }

    const scale = Math.min(1, maxWidth / Math.max(1, info.width));
    const w = Math.round(info.width * scale);
    const h = Math.round(info.height * scale);
    const derivatives: Derivative[] = [];
    for (let i = 0; i < written.length; i++) {
      const out = path.join(opts.outDir, `${opts.baseName}.f${String(i).padStart(4, "0")}.jpg`);
      await rename(path.join(tmp, written[i]), out);
      derivatives.push({
        variant: "frame",
        idx: i,
        path: out,
        mime: "image/jpeg",
        width: w - (w % 2),
        height: h - (h % 2),
        colorPrimaries: info.colorPrimaries,
        colorTransfer: info.colorTransfer,
      });
    }
    return derivatives;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/**
 * Where a frame of the original video lands in the slideshow: the last slide
 * to start at or before it (a frame mid-crossfade goes to the outgoing image,
 * one before the first slide to the first). Used to move annotations drawn
 * on the video version.
 */
export function slideOf(frame: number, starts: number[]): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= frame) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
