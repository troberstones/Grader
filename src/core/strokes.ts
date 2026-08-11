import { STROKE_TOOLS, type Stroke, type StrokeTool } from "./types";

/**
 * Binary stroke codec.
 *
 * Fabric's toJSON() for one freehand stroke is 4–8 KB: every default property,
 * plus SVG path commands as decimal strings. That is the wrong order of
 * magnitude for streaming ink across a room. This format puts a typical
 * 200-point stroke in ~400 bytes.
 *
 *   u8    version
 *   u8    tool
 *   u8    flags     bit0 pressure, bit1 filled, bit2 text, bit3 layers
 *   u8    width     reference px (see Stroke.width)
 *   u32   rgba      big-endian 0xRRGGBBAA
 *   u16   pointCount
 *         pointCount × { zigzag-varint dx, zigzag-varint dy }   14-bit grid
 *   [     pointCount × u8 pressure                          ]  if flags bit0
 *   [     u16 byteLen + utf8                                ]  if flags bit2
 *   [     u8 count + (u16 len + utf8) × count               ]  if flags bit3
 *
 * Coordinates are normalised to 0..1 of media width/height, then quantised to a
 * 14-bit grid (0..16383) — sub-pixel for anything up to 16k across — and delta
 * encoded, so ordinary drawing speeds keep each component in a single byte.
 */

export const STROKE_FORMAT_VERSION = 1;
const GRID = 16383;

const FLAG_PRESSURE = 1;
const FLAG_FILLED = 2;
const FLAG_TEXT = 4;
const FLAG_LAYERS = 8;

// ── varint helpers ────────────────────────────────────────────────────────────

const zigzag = (n: number): number => (n << 1) ^ (n >> 31);
const unzigzag = (n: number): number => (n >>> 1) ^ -(n & 1);

class Writer {
  private buf = new Uint8Array(1024);
  private len = 0;

  private ensure(n: number) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  u8(v: number) {
    this.ensure(1);
    this.buf[this.len++] = v & 0xff;
  }

  u16(v: number) {
    this.ensure(2);
    this.buf[this.len++] = (v >>> 8) & 0xff;
    this.buf[this.len++] = v & 0xff;
  }

  u32(v: number) {
    this.ensure(4);
    this.buf[this.len++] = (v >>> 24) & 0xff;
    this.buf[this.len++] = (v >>> 16) & 0xff;
    this.buf[this.len++] = (v >>> 8) & 0xff;
    this.buf[this.len++] = v & 0xff;
  }

  varint(v: number) {
    let n = v >>> 0;
    this.ensure(5);
    while (n >= 0x80) {
      this.buf[this.len++] = (n & 0x7f) | 0x80;
      n >>>= 7;
    }
    this.buf[this.len++] = n;
  }

  bytes(b: Uint8Array) {
    this.ensure(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

class Reader {
  private pos = 0;
  constructor(private buf: Uint8Array) {}

  get done() {
    return this.pos >= this.buf.length;
  }

  u8(): number {
    if (this.pos >= this.buf.length) throw new RangeError("stroke: truncated");
    return this.buf[this.pos++];
  }

  u16(): number {
    return (this.u8() << 8) | this.u8();
  }

  u32(): number {
    return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0;
  }

  varint(): number {
    let shift = 0;
    let out = 0;
    for (;;) {
      const b = this.u8();
      out |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 35) throw new RangeError("stroke: varint overflow");
    }
    return out >>> 0;
  }

  bytes(n: number): Uint8Array {
    if (this.pos + n > this.buf.length) throw new RangeError("stroke: truncated");
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
}

// ── encode / decode ───────────────────────────────────────────────────────────

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function encodeStroke(s: Stroke): Uint8Array {
  const w = new Writer();
  const pointCount = Math.floor(s.points.length / 2);
  if (pointCount > 0xffff) {
    throw new RangeError(`stroke: ${pointCount} points exceeds the 65535 limit`);
  }

  const hasPressure = !!s.pressure && s.pressure.length >= pointCount && pointCount > 0;
  const hasText = typeof s.text === "string" && s.text.length > 0;
  const hasLayers = !!s.layers && s.layers.length > 0;

  let flags = 0;
  if (hasPressure) flags |= FLAG_PRESSURE;
  if (s.filled) flags |= FLAG_FILLED;
  if (hasText) flags |= FLAG_TEXT;
  if (hasLayers) flags |= FLAG_LAYERS;

  w.u8(STROKE_FORMAT_VERSION);
  w.u8(Math.max(0, STROKE_TOOLS.indexOf(s.tool)));
  w.u8(flags);
  w.u8(Math.min(255, Math.max(0, Math.round(s.width))));
  w.u32(s.color >>> 0);
  w.u16(pointCount);

  let px = 0;
  let py = 0;
  for (let i = 0; i < pointCount; i++) {
    const qx = quantise(s.points[i * 2]);
    const qy = quantise(s.points[i * 2 + 1]);
    w.varint(zigzag(qx - px));
    w.varint(zigzag(qy - py));
    px = qx;
    py = qy;
  }

  if (hasPressure) {
    for (let i = 0; i < pointCount; i++) {
      w.u8(Math.round(Math.min(1, Math.max(0, s.pressure![i])) * 255));
    }
  }

  if (hasText) {
    const bytes = textEncoder.encode(s.text!);
    w.u16(Math.min(bytes.length, 0xffff));
    w.bytes(bytes.subarray(0, 0xffff));
  }

  if (hasLayers) {
    const ids = s.layers!.slice(0, 255);
    w.u8(ids.length);
    for (const id of ids) {
      const bytes = textEncoder.encode(id);
      w.u16(bytes.length);
      w.bytes(bytes);
    }
  }

  return w.finish();
}

function quantise(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(Math.min(1, Math.max(0, v)) * GRID);
}

export interface DecodeMeta {
  id?: number;
  seq?: number;
  localId?: string;
  frameIn: number;
  frameOut: number;
  authorId: string;
  createdAt?: string;
}

export function decodeStroke(data: Uint8Array, meta: DecodeMeta): Stroke {
  const r = new Reader(data);
  const version = r.u8();
  if (version !== STROKE_FORMAT_VERSION) {
    throw new RangeError(`stroke: unsupported format version ${version}`);
  }
  const toolIndex = r.u8();
  const flags = r.u8();
  const width = r.u8();
  const color = r.u32();
  const pointCount = r.u16();

  const points = new Array<number>(pointCount * 2);
  let px = 0;
  let py = 0;
  for (let i = 0; i < pointCount; i++) {
    px += unzigzag(r.varint());
    py += unzigzag(r.varint());
    points[i * 2] = px / GRID;
    points[i * 2 + 1] = py / GRID;
  }

  let pressure: number[] | undefined;
  if (flags & FLAG_PRESSURE) {
    pressure = new Array<number>(pointCount);
    for (let i = 0; i < pointCount; i++) pressure[i] = r.u8() / 255;
  }

  let text: string | undefined;
  if (flags & FLAG_TEXT) {
    text = textDecoder.decode(r.bytes(r.u16()));
  }

  let layers: string[] | undefined;
  if (flags & FLAG_LAYERS) {
    const count = r.u8();
    layers = [];
    for (let i = 0; i < count; i++) layers.push(textDecoder.decode(r.bytes(r.u16())));
  }

  return {
    id: meta.id,
    seq: meta.seq,
    localId: meta.localId ?? `s${meta.id ?? Math.random().toString(36).slice(2)}`,
    tool: (STROKE_TOOLS[toolIndex] ?? "pen") as StrokeTool,
    color,
    width,
    frameIn: meta.frameIn,
    frameOut: meta.frameOut,
    authorId: meta.authorId,
    points,
    pressure,
    text,
    filled: !!(flags & FLAG_FILLED),
    layers,
    createdAt: meta.createdAt,
  };
}

// ── base64 (for the JSON channel; the DB stores raw BLOBs) ────────────────────

/**
 * Reached from both the browser and the Next server, so neither `Buffer` nor
 * `btoa` can be assumed. Typed off globalThis to keep this file free of
 * @types/node — it has to stay importable from a plain browser bundle.
 */
interface BufferLike {
  from(input: Uint8Array | string, enc?: string): { toString(enc: string): string } & Uint8Array;
}
const nodeBuffer = (globalThis as unknown as { Buffer?: BufferLike }).Buffer;

export function toBase64(bytes: Uint8Array): string {
  if (nodeBuffer) return nodeBuffer.from(bytes).toString("base64");
  let s = "";
  // Chunked to avoid blowing the argument limit on a long stroke.
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  if (nodeBuffer) return new Uint8Array(nodeBuffer.from(b64, "base64"));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── colour helpers ────────────────────────────────────────────────────────────

/** 0xRRGGBBAA → "rgba(r, g, b, a)". */
export function rgbaToCss(c: number): string {
  const r = (c >>> 24) & 0xff;
  const g = (c >>> 16) & 0xff;
  const b = (c >>> 8) & 0xff;
  const a = c & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

/** "#rrggbb" or "#rrggbbaa" → packed 0xRRGGBBAA. */
export function hexToRgba(hex: string, alpha = 1): number {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : Math.round(alpha * 255);
  return (((r << 24) | (g << 16) | (b << 8) | a) >>> 0) as number;
}

export function rgbaToHex(c: number): string {
  const r = (c >>> 24) & 0xff;
  const g = (c >>> 16) & 0xff;
  const b = (c >>> 8) & 0xff;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// ── simplification & smoothing ────────────────────────────────────────────────

/**
 * Ramer–Douglas–Peucker on a flat [x,y,…] array in normalised space.
 * Iterative to avoid blowing the stack on a long stroke.
 */
export function simplify(points: number[], epsilon: number): number[] {
  const n = points.length / 2;
  if (n <= 2) return points.slice();

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];

  while (stack.length) {
    const [start, end] = stack.pop()!;
    if (end - start < 2) continue;
    const ax = points[start * 2];
    const ay = points[start * 2 + 1];
    const bx = points[end * 2];
    const by = points[end * 2 + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    let maxD = -1;
    let maxI = -1;
    for (let i = start + 1; i < end; i++) {
      const px = points[i * 2];
      const py = points[i * 2 + 1];
      let d: number;
      if (lenSq === 0) {
        d = Math.hypot(px - ax, py - ay);
      } else {
        const t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
        const cx = ax + Math.min(1, Math.max(0, t)) * dx;
        const cy = ay + Math.min(1, Math.max(0, t)) * dy;
        d = Math.hypot(px - cx, py - cy);
      }
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }

    if (maxD > epsilon && maxI > 0) {
      keep[maxI] = 1;
      stack.push([start, maxI], [maxI, end]);
    }
  }

  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) out.push(points[i * 2], points[i * 2 + 1]);
  }
  return out;
}

/**
 * One-euro-ish smoothing pass applied while drawing.
 * RDP reduces point count but does nothing for shaky touch input; this does.
 */
export class Smoother {
  private x = 0;
  private y = 0;
  private started = false;

  constructor(private alpha = 0.45) {}

  reset() {
    this.started = false;
  }

  push(x: number, y: number): [number, number] {
    if (!this.started) {
      this.x = x;
      this.y = y;
      this.started = true;
      return [x, y];
    }
    this.x += (x - this.x) * this.alpha;
    this.y += (y - this.y) * this.alpha;
    return [this.x, this.y];
  }
}
