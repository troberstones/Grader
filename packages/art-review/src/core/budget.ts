/**
 * Frame-cache memory budgets.
 *
 * These are budgets for a BROWSER TAB, not for the machine. That distinction is
 * the whole point and getting it wrong is expensive: a 128 GB workstation does
 * not let a web page have 128 GB. Chrome's renderer heap tops out around 4 GB,
 * large ArrayBuffers count against it, and anything approaching that number
 * pushes the whole machine into swap while the tab still believes it is fine.
 * Chrome also caps GPU memory per context, and exceeding that fires
 * `webglcontextlost` rather than crashing.
 *
 * So the ceilings below are deliberately far below physical memory, and the
 * shared MemoryLedger enforces a single total across every open source — a
 * per-source budget multiplied by prefetched neighbours was how this went
 * wrong the first time.
 *
 * Replace with numbers measured on the real hardware, but keep them in this
 * range: the constraint is the tab, not the RAM.
 */

export interface Budget {
  name: string;
  /** L1: WebGL textures near the playhead. Bytes. */
  vram: number;
  /** L2: decoded frame buffers in system RAM. Bytes. */
  ram: number;
  /** Cache at native resolution up to this width; downscale beyond it. */
  maxCacheWidth: number;
  /** Frames to hold as textures around the playhead. */
  l1Frames: number;
  /** Prefetch this many neighbouring playlist items into L2. */
  prefetchItems: number;
}

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

export const BUDGETS: Record<string, Budget> = {
  workstation: {
    name: "Review workstation",
    vram: 768 * MB,
    ram: 1536 * MB,
    maxCacheWidth: 1920,
    l1Frames: 240,
    // Prefetch warms stills and posters only — never a second video decoder.
    prefetchItems: 2,
  },
  laptopLarge: {
    name: "MacBook Pro (48 GB+)",
    vram: 512 * MB,
    ram: 1024 * MB,
    maxCacheWidth: 1920,
    l1Frames: 180,
    prefetchItems: 1,
  },
  laptopSmall: {
    name: "MacBook Pro (16–32 GB)",
    vram: 384 * MB,
    ram: 640 * MB,
    maxCacheWidth: 1600,
    l1Frames: 120,
    prefetchItems: 1,
  },
  tablet: {
    name: "iPad",
    vram: 256 * MB,
    ram: 384 * MB,
    maxCacheWidth: 1280,
    l1Frames: 90,
    prefetchItems: 0,
  },
  conservative: {
    name: "Unknown device",
    vram: 192 * MB,
    ram: 320 * MB,
    maxCacheWidth: 1280,
    l1Frames: 60,
    prefetchItems: 0,
  },
};

/**
 * Hard ceiling across every source in the tab, whatever the tier says.
 * Nothing may allocate past this — see MemoryLedger.
 */
export const ABSOLUTE_RAM_CEILING = 2 * GB;

/**
 * Bytes for one cached frame.
 *
 * RGBA, not RGB: `VideoFrame.copyTo` produces RGBA and a canvas readback gives
 * RGBA, so packing down to three channels would cost a full extra pass over
 * every frame to save 25%. Real capacity is therefore 3/4 of an RGB8 estimate —
 * 1080p is 8.3 MB per frame, ~120 frames per GB.
 */
export function frameBytes(width: number, height: number, channels = 4): number {
  return width * height * channels;
}

export function framesThatFit(budgetBytes: number, width: number, height: number): number {
  return Math.max(1, Math.floor(budgetBytes / frameBytes(width, height)));
}

interface DetectHints {
  userAgent?: string;
  deviceMemory?: number;
  maxTouchPoints?: number;
  /** Override from settings; wins over detection. */
  forced?: keyof typeof BUDGETS;
}

/**
 * Pick a budget tier. Deliberately coarse — the fine number comes from
 * measurement, not from sniffing.
 */
export function detectBudget(hints: DetectHints = {}): Budget {
  if (hints.forced && BUDGETS[hints.forced]) return BUDGETS[hints.forced];

  const ua = hints.userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  const touch = hints.maxTouchPoints ?? (typeof navigator !== "undefined" ? navigator.maxTouchPoints : 0);

  // iPadOS reports a desktop Safari UA; the touch-point count is the tell.
  const isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && (touch ?? 0) > 1);
  if (isIPad || /iPhone|Android/.test(ua)) return BUDGETS.tablet;

  const mem =
    hints.deviceMemory ??
    (typeof navigator !== "undefined"
      ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory
      : undefined);

  // navigator.deviceMemory is Chrome-only and caps at 8, so it can confirm a
  // small machine but never identifies a large one. Safari reports nothing.
  if (mem !== undefined && mem <= 8) return BUDGETS.laptopSmall;
  if (mem !== undefined && mem > 8) return BUDGETS.laptopLarge;
  return BUDGETS.conservative;
}

/**
 * Choose the cache resolution for an item given a budget.
 * Above `maxCacheWidth`, or when the clip cannot fit at native size, step down
 * in halves until the whole clip fits or we hit the floor.
 */
export function chooseCacheSize(
  budget: Budget,
  width: number,
  height: number,
  frameCount: number,
  viewportWidth: number,
): { width: number; height: number; fitsWholeClip: boolean; scale: number } {
  const ceiling = Math.min(width, budget.maxCacheWidth);
  // Never cache more pixels than the viewport can show at 2x zoom headroom —
  // beyond that, a paused full-res decode is cheaper than the memory.
  const useful = Math.max(640, Math.min(ceiling, Math.ceil(viewportWidth * 2)));

  let scale = Math.min(1, useful / width);
  for (let i = 0; i < 4; i++) {
    const w = Math.max(320, Math.round(width * scale));
    const h = Math.max(180, Math.round(height * scale));
    if (frameBytes(w, h) * frameCount <= budget.ram) {
      return { width: w, height: h, fitsWholeClip: true, scale };
    }
    scale *= 0.5;
  }
  const w = Math.max(320, Math.round(width * scale));
  const h = Math.max(180, Math.round(height * scale));
  return { width: w, height: h, fitsWholeClip: false, scale };
}

/**
 * The up-front cost of the decoded frame cache, expressed as what it makes the
 * viewer wait for before the first frame appears.
 *
 * DecodedVideoSource buys frame-exact scrubbing and reverse play, and pays for
 * it twice before showing anything: it fetches the *entire* file into an
 * ArrayBuffer (mp4box demuxes from one buffer, not a stream), then runs the
 * decoder over every sample in the clip, keeping only the frames near the
 * playhead. Both costs scale with the length of the clip, and neither is
 * incremental — a long clip shows nothing at all until both finish.
 *
 * For a student's few-second render that is a fraction of a second and worth
 * it. For a lecture-length clip it is neither: a 3m24s interview proxy is
 * ~150 MB to download and ~4,900 frames to decode, to cache about 1% of itself
 * and then re-decode on every seek. `<video>` streams that in Range requests
 * and paints in about a second, which is why VideoElementSource exists as more
 * than a no-WebCodecs fallback.
 *
 * So the two limits below are wait times, not memory: frames bound the decode
 * pass, seconds bound the download. A clip over either goes to `<video>`.
 */
export const MAX_CACHE_FRAMES = 900;
export const MAX_CACHE_SECONDS = 45;

export function suitsFrameCache(clip: {
  frameCount?: number | null;
  duration?: number | null;
}): boolean {
  const frames = clip.frameCount ?? 0;
  const seconds = clip.duration ?? 0;
  if (frames > MAX_CACHE_FRAMES) return false;
  if (seconds > MAX_CACHE_SECONDS) return false;
  return true;
}
