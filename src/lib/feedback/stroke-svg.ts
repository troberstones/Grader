import type { Stroke } from "@grader/art-review/core";

/**
 * Annotation strokes → SVG, for compositing onto a frame on the server.
 *
 * A port of drawOne() in packages/art-review/src/render/overlay.ts, tool for
 * tool, with the view transform left out: an emailed frame is the artwork as
 * submitted — no zoom, pan, flip or rotate. Keep the two in step; a stroke
 * that renders differently here than in the reviewer is a note the student
 * reads differently than it was written.
 *
 * Strokes are in normalised media space (0..1), so the SVG's viewBox is the
 * media's own pixel size and any output size is just the SVG's width/height.
 */

/** The reference width strokes were authored against. See Stroke.width. */
const REFERENCE_WIDTH = 2000;

export function mediaLineWidth(stroke: Pick<Stroke, "width">, mediaWidth: number): number {
  return Math.max(0.5, (stroke.width * mediaWidth) / REFERENCE_WIDTH);
}

/**
 * Is this stroke just a dot — a tap, or a drag so short it never became a
 * mark? A frame whose only annotations are dots is left out of the email:
 * those are almost always a pencil touching down by accident, or a "look here"
 * that means nothing without the conversation it was part of.
 *
 * Text and stamps are never dots. Both are placed with a single point on
 * purpose, and both carry meaning on their own.
 */
export function isDot(stroke: Stroke, mediaWidth: number, mediaHeight: number): boolean {
  if (stroke.tool === "text" || stroke.tool === "stamp") return false;
  const pts = stroke.points;
  const n = pts.length / 2;
  if (n < 2) return true;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2] * mediaWidth;
    const y = pts[i * 2 + 1] * mediaHeight;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const extent = Math.hypot(maxX - minX, maxY - minY);
  // Three line-widths across is still a blob of ink, not a line; the pixel
  // floor covers hairline pens on small media.
  return extent < Math.max(mediaLineWidth(stroke, mediaWidth) * 3, 6);
}

function colorAttrs(c: number, kind: "stroke" | "fill"): string {
  const r = (c >>> 24) & 0xff;
  const g = (c >>> 16) & 0xff;
  const b = (c >>> 8) & 0xff;
  const a = (c & 0xff) / 255;
  const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  return `${kind}="${hex}" ${kind}-opacity="${a.toFixed(3)}"`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[ch]!);
}

const f = (n: number) => (Math.round(n * 100) / 100).toString();

function strokeToSvg(s: Stroke, W: number, H: number): string {
  const lw = mediaLineWidth(s, W);
  const pts = s.points;
  const n = pts.length / 2;
  const mx = (i: number) => pts[i * 2] * W;
  const my = (i: number) => pts[i * 2 + 1] * H;
  const line = `${colorAttrs(s.color, "stroke")} stroke-width="${f(lw)}" stroke-linecap="round" stroke-linejoin="round" fill="none"`;

  switch (s.tool) {
    case "pen":
    case "highlight": {
      if (n < 2) {
        if (n === 1) return `<circle cx="${f(mx(0))}" cy="${f(my(0))}" r="${f(lw / 2)}" ${colorAttrs(s.color, "fill")}/>`;
        return "";
      }
      if (s.pressure && s.pressure.length === n) {
        const segs: string[] = [];
        for (let i = 1; i < n; i++) {
          const w = Math.max(0.4, lw * (0.35 + 1.3 * s.pressure[i]));
          segs.push(
            `<line x1="${f(mx(i - 1))}" y1="${f(my(i - 1))}" x2="${f(mx(i))}" y2="${f(my(i))}" ${colorAttrs(s.color, "stroke")} stroke-width="${f(w)}" stroke-linecap="round"/>`,
          );
        }
        return segs.join("");
      }
      let d = `M${f(mx(0))} ${f(my(0))}`;
      for (let i = 1; i < n - 1; i++) {
        d += ` Q${f(mx(i))} ${f(my(i))} ${f((mx(i) + mx(i + 1)) / 2)} ${f((my(i) + my(i + 1)) / 2)}`;
      }
      d += ` L${f(mx(n - 1))} ${f(my(n - 1))}`;
      return `<path d="${d}" ${line}/>`;
    }

    case "line": {
      if (n < 2) return "";
      return `<line x1="${f(mx(0))}" y1="${f(my(0))}" x2="${f(mx(n - 1))}" y2="${f(my(n - 1))}" ${line}/>`;
    }

    case "arrow": {
      if (n < 2) return "";
      const x1 = mx(0), y1 = my(0), x2 = mx(n - 1), y2 = my(n - 1);
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const head = Math.min(lw * 5, Math.hypot(x2 - x1, y2 - y1) * 0.35);
      const hx1 = x2 - head * Math.cos(angle - 0.45), hy1 = y2 - head * Math.sin(angle - 0.45);
      const hx2 = x2 - head * Math.cos(angle + 0.45), hy2 = y2 - head * Math.sin(angle + 0.45);
      return (
        `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" ${line}/>` +
        `<polygon points="${f(x2)},${f(y2)} ${f(hx1)},${f(hy1)} ${f(hx2)},${f(hy2)}" ${colorAttrs(s.color, "fill")}/>`
      );
    }

    case "rect": {
      if (n < 2) return "";
      const x = Math.min(mx(0), mx(n - 1));
      const y = Math.min(my(0), my(n - 1));
      const w = Math.abs(mx(n - 1) - mx(0));
      const h = Math.abs(my(n - 1) - my(0));
      return s.filled
        ? `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" ${colorAttrs(s.color, "fill")}/>`
        : `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" ${line}/>`;
    }

    case "ellipse": {
      if (n < 2) return "";
      const cx = (mx(0) + mx(n - 1)) / 2;
      const cy = (my(0) + my(n - 1)) / 2;
      const rx = Math.abs(mx(n - 1) - mx(0)) / 2;
      const ry = Math.abs(my(n - 1) - my(0)) / 2;
      return s.filled
        ? `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" ${colorAttrs(s.color, "fill")}/>`
        : `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" ${line}/>`;
    }

    case "text": {
      if (n < 1 || !s.text) return "";
      const size = Math.max(8, (s.width * W) / REFERENCE_WIDTH) * 4;
      const lines = s.text.split("\n");
      const lineHeight = size * 1.25;
      // No text measurement on the server; 0.56em is a fair average advance
      // for a sans-serif, and the plate only needs to be roughly right.
      const widest = Math.max(...lines.map((l) => l.length)) * size * 0.56;
      const x = mx(0), y = my(0);
      const plate = `<rect x="${f(x - size * 0.2)}" y="${f(y - size * 0.15)}" width="${f(widest + size * 0.4)}" height="${f(lineHeight * lines.length + size * 0.3)}" fill="#000000" fill-opacity="0.55"/>`;
      const text = lines
        .map(
          (l, i) =>
            `<text x="${f(x)}" y="${f(y + i * lineHeight)}" dominant-baseline="text-before-edge" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="${f(size)}" ${colorAttrs(s.color, "fill")}>${escapeXml(l)}</text>`,
        )
        .join("");
      return plate + text;
    }

    case "stamp": {
      if (n < 1) return "";
      return `<circle cx="${f(mx(0))}" cy="${f(my(0))}" r="${f(lw * 3)}" ${line}/>`;
    }

    default:
      return "";
  }
}

/**
 * One SVG per blend mode: highlighter strokes multiply in the reviewer, so
 * they go in their own layer that the caller composites with `multiply`.
 * Either may be null when there is nothing of that kind to draw.
 */
export function strokesToSvg(
  strokes: Stroke[],
  mediaWidth: number,
  mediaHeight: number,
  outWidth: number,
  outHeight: number,
): { normal: string | null; highlight: string | null } {
  const wrap = (body: string) =>
    body
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="${outWidth}" height="${outHeight}" viewBox="0 0 ${mediaWidth} ${mediaHeight}">${body}</svg>`
      : null;
  const highlight = strokes.filter((s) => s.tool === "highlight").map((s) => strokeToSvg(s, mediaWidth, mediaHeight)).join("");
  const normal = strokes.filter((s) => s.tool !== "highlight").map((s) => strokeToSvg(s, mediaWidth, mediaHeight)).join("");
  return { normal: wrap(normal), highlight: wrap(highlight) };
}
