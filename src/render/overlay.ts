import { rgbaToCss } from "../core/strokes";
import type { GuideKind, Stroke } from "../core/types";
import type { ViewParams } from "./gl";

/**
 * Annotation overlay: a 2D canvas sharing the WebGL layer's view transform.
 *
 * Strokes live in normalised media space (0..1), so the same stroke lands in
 * the same place on the iPad, the laptop and the projector regardless of canvas
 * size, zoom, pan or flip. That is the whole reason for the normalisation — a
 * stroke stored in viewport pixels is only correct on the machine that drew it.
 */

/** The reference width strokes were authored against. See Stroke.width. */
const REFERENCE_WIDTH = 2000;

export interface DrawOptions {
  /** Fade strokes by age; 0 disables (permanent ink). */
  ghostMs?: number;
  now?: number;
  /** Author ids to hide. */
  hiddenAuthors?: Set<string>;
  /** Draw at reduced alpha — used for onion-skinned neighbour frames. */
  alpha?: number;
  /** Highlight this stroke (hover / just-selected). */
  highlightId?: number | string | null;
}

/**
 * media space → screen space as a 2D affine, matching the vertex shader
 * exactly. Any divergence shows up as annotations sliding off the artwork.
 */
export function mediaTransform(p: ViewParams): DOMMatrix2DInit {
  const fitScale = Math.min(
    p.canvasWidth / Math.max(1, p.mediaWidth),
    p.canvasHeight / Math.max(1, p.mediaHeight),
  );
  const s = fitScale * p.zoom;
  const th = (p.rotate * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const fx = p.flipH ? -1 : 1;
  const fy = p.flipV ? -1 : 1;

  const a = s * cos * fx;
  const b = s * sin * fx;
  const c = -s * sin * fy;
  const d = s * cos * fy;

  const ccx = p.canvasWidth / 2 + p.panX;
  const ccy = p.canvasHeight / 2 + p.panY;
  const cx = p.mediaWidth / 2;
  const cy = p.mediaHeight / 2;

  return { a, b, c, d, e: ccx - (a * cx + c * cy), f: ccy - (b * cx + d * cy) };
}

export function clearOverlay(ctx: CanvasRenderingContext2D, p: ViewParams): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, p.canvasWidth, p.canvasHeight);
}

/** Stroke width in media pixels, from the stored resolution-independent value. */
function mediaLineWidth(stroke: Stroke, mediaWidth: number): number {
  return Math.max(0.5, (stroke.width * mediaWidth) / REFERENCE_WIDTH);
}

export function drawStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  p: ViewParams,
  opts: DrawOptions = {},
): void {
  if (strokes.length === 0) return;
  const m = mediaTransform(p);
  ctx.save();
  ctx.setTransform(m.a!, m.b!, m.c!, m.d!, m.e!, m.f!);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const now = opts.now ?? Date.now();

  for (const s of strokes) {
    if (opts.hiddenAuthors?.has(s.authorId)) continue;

    let alpha = opts.alpha ?? 1;
    if (opts.ghostMs && s.createdAt) {
      const age = now - Date.parse(s.createdAt);
      if (age > opts.ghostMs) continue;
      alpha *= Math.max(0, 1 - age / opts.ghostMs);
    }
    if (alpha <= 0.01) continue;

    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = s.tool === "highlight" ? "multiply" : "source-over";
    drawOne(ctx, s, p);

    if (opts.highlightId != null && (s.id === opts.highlightId || s.localId === opts.highlightId)) {
      ctx.globalAlpha = alpha * 0.5;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = mediaLineWidth(s, p.mediaWidth) + 4;
      strokePath(ctx, s, p);
    }
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.restore();
}

function strokePath(ctx: CanvasRenderingContext2D, s: Stroke, p: ViewParams): void {
  const pts = s.points;
  if (pts.length < 4) return;
  ctx.beginPath();
  ctx.moveTo(pts[0] * p.mediaWidth, pts[1] * p.mediaHeight);
  for (let i = 2; i < pts.length; i += 2) {
    ctx.lineTo(pts[i] * p.mediaWidth, pts[i + 1] * p.mediaHeight);
  }
  ctx.stroke();
}

function drawOne(ctx: CanvasRenderingContext2D, s: Stroke, p: ViewParams): void {
  const css = rgbaToCss(s.color);
  const lw = mediaLineWidth(s, p.mediaWidth);
  const pts = s.points;
  ctx.strokeStyle = css;
  ctx.fillStyle = css;
  ctx.lineWidth = lw;

  const mx = (i: number) => pts[i * 2] * p.mediaWidth;
  const my = (i: number) => pts[i * 2 + 1] * p.mediaHeight;
  const n = pts.length / 2;

  switch (s.tool) {
    case "pen":
    case "highlight": {
      if (n < 2) {
        // A tap is a dot, not nothing.
        if (n === 1) {
          ctx.beginPath();
          ctx.arc(mx(0), my(0), lw / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        return;
      }
      if (s.pressure && s.pressure.length === n) {
        // Variable width needs one segment per pair; Apple Pencil earns this.
        for (let i = 1; i < n; i++) {
          ctx.beginPath();
          ctx.lineWidth = Math.max(0.4, lw * (0.35 + 1.3 * s.pressure[i]));
          ctx.moveTo(mx(i - 1), my(i - 1));
          ctx.lineTo(mx(i), my(i));
          ctx.stroke();
        }
        return;
      }
      // Quadratic smoothing through midpoints — the same curve PencilBrush
      // produces, so simplified strokes still look hand-drawn.
      ctx.beginPath();
      ctx.moveTo(mx(0), my(0));
      for (let i = 1; i < n - 1; i++) {
        ctx.quadraticCurveTo(mx(i), my(i), (mx(i) + mx(i + 1)) / 2, (my(i) + my(i + 1)) / 2);
      }
      ctx.lineTo(mx(n - 1), my(n - 1));
      ctx.stroke();
      return;
    }

    case "line": {
      if (n < 2) return;
      ctx.beginPath();
      ctx.moveTo(mx(0), my(0));
      ctx.lineTo(mx(n - 1), my(n - 1));
      ctx.stroke();
      return;
    }

    case "arrow": {
      if (n < 2) return;
      const x1 = mx(0);
      const y1 = my(0);
      const x2 = mx(n - 1);
      const y2 = my(n - 1);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      const angle = Math.atan2(y2 - y1, x2 - x1);
      const head = Math.min(lw * 5, Math.hypot(x2 - x1, y2 - y1) * 0.35);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(angle - 0.45), y2 - head * Math.sin(angle - 0.45));
      ctx.lineTo(x2 - head * Math.cos(angle + 0.45), y2 - head * Math.sin(angle + 0.45));
      ctx.closePath();
      ctx.fill();
      return;
    }

    case "rect": {
      if (n < 2) return;
      const x = Math.min(mx(0), mx(n - 1));
      const y = Math.min(my(0), my(n - 1));
      const w = Math.abs(mx(n - 1) - mx(0));
      const h = Math.abs(my(n - 1) - my(0));
      if (s.filled) ctx.fillRect(x, y, w, h);
      else ctx.strokeRect(x, y, w, h);
      return;
    }

    case "ellipse": {
      if (n < 2) return;
      const cx = (mx(0) + mx(n - 1)) / 2;
      const cy = (my(0) + my(n - 1)) / 2;
      const rx = Math.abs(mx(n - 1) - mx(0)) / 2;
      const ry = Math.abs(my(n - 1) - my(0)) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      if (s.filled) ctx.fill();
      else ctx.stroke();
      return;
    }

    case "text": {
      if (n < 1 || !s.text) return;
      drawText(ctx, s, p, mx(0), my(0));
      return;
    }

    case "stamp": {
      if (n < 1) return;
      ctx.beginPath();
      ctx.arc(mx(0), my(0), lw * 3, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
  }
}

/**
 * Text is anchored in media space but must stay readable: a mirrored image
 * should not mirror the instructor's handwriting. So the glyphs get the
 * inverse of the flip/rotate applied about their own anchor.
 */
function drawText(
  ctx: CanvasRenderingContext2D,
  s: Stroke,
  p: ViewParams,
  x: number,
  y: number,
): void {
  const size = Math.max(8, (s.width * p.mediaWidth) / REFERENCE_WIDTH) * 4;
  ctx.save();
  ctx.translate(x, y);
  if (p.flipH || p.flipV) ctx.scale(p.flipH ? -1 : 1, p.flipV ? -1 : 1);
  if (p.rotate) ctx.rotate((-p.rotate * Math.PI) / 180);

  ctx.font = `${size}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
  ctx.textBaseline = "top";

  const lines = s.text!.split("\n");
  const lineHeight = size * 1.25;
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));

  // A backing plate keeps notes legible over busy artwork.
  ctx.globalAlpha *= 0.55;
  ctx.fillStyle = "#000000";
  ctx.fillRect(-size * 0.2, -size * 0.15, widest + size * 0.4, lineHeight * lines.length + size * 0.3);
  ctx.globalAlpha /= 0.55;

  ctx.fillStyle = rgbaToCss(s.color);
  lines.forEach((line, i) => ctx.fillText(line, 0, i * lineHeight));
  ctx.restore();
}

/** In-progress stroke from a remote peer, or the local one being drawn. */
export function drawLiveInk(
  ctx: CanvasRenderingContext2D,
  ink: { tool: Stroke["tool"]; color: number; width: number; points: number[]; pressure?: number[] },
  p: ViewParams,
): void {
  drawStrokes(
    ctx,
    [
      {
        localId: "live",
        tool: ink.tool,
        color: ink.color,
        width: ink.width,
        frameIn: 0,
        frameOut: 0,
        authorId: "live",
        points: ink.points,
        pressure: ink.pressure,
      },
    ],
    p,
  );
}

/** Transient pointer dot broadcast during a live crit. Never stored. */
export function drawLaser(
  ctx: CanvasRenderingContext2D,
  pointers: { x: number; y: number; color: number; age: number }[],
  p: ViewParams,
): void {
  if (pointers.length === 0) return;
  const m = mediaTransform(p);
  ctx.save();
  ctx.setTransform(m.a!, m.b!, m.c!, m.d!, m.e!, m.f!);
  const r = p.mediaWidth / 110;
  for (const ptr of pointers) {
    const fade = Math.max(0, 1 - ptr.age / 1200);
    if (fade <= 0) continue;
    const x = ptr.x * p.mediaWidth;
    const y = ptr.y * p.mediaHeight;
    ctx.globalAlpha = fade * 0.35;
    ctx.fillStyle = rgbaToCss(ptr.color);
    ctx.beginPath();
    ctx.arc(x, y, r * 1.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = fade;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.62, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** Composition guides — the classic critique overlays. */
// GuideKind lives in core/types now: it is part of ViewerState, so the reducer
// needs it, and the reducer never imports the renderer. Re-exported here so
// existing importers do not have to care.
export type { GuideKind };

export function drawGuides(
  ctx: CanvasRenderingContext2D,
  kind: GuideKind,
  p: ViewParams,
): void {
  if (kind === "none") return;
  const m = mediaTransform(p);
  ctx.save();
  ctx.setTransform(m.a!, m.b!, m.c!, m.d!, m.e!, m.f!);
  ctx.strokeStyle = "rgba(255,255,255,0.34)";
  ctx.lineWidth = p.mediaWidth / 900 / Math.max(0.4, p.zoom);
  const W = p.mediaWidth;
  const H = p.mediaHeight;

  const vlines: number[] = [];
  const hlines: number[] = [];

  if (kind === "thirds") {
    vlines.push(W / 3, (2 * W) / 3);
    hlines.push(H / 3, (2 * H) / 3);
  } else if (kind === "golden") {
    const g = 0.381966;
    vlines.push(W * g, W * (1 - g));
    hlines.push(H * g, H * (1 - g));
  } else if (kind === "center") {
    vlines.push(W / 2);
    hlines.push(H / 2);
  } else if (kind === "grid") {
    for (let i = 1; i < 8; i++) {
      vlines.push((W * i) / 8);
      hlines.push((H * i) / 8);
    }
  }

  ctx.beginPath();
  for (const x of vlines) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
  }
  for (const y of hlines) {
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
  }
  if (kind === "diagonals") {
    ctx.moveTo(0, 0);
    ctx.lineTo(W, H);
    ctx.moveTo(W, 0);
    ctx.lineTo(0, H);
  }
  ctx.stroke();
  ctx.restore();
}
