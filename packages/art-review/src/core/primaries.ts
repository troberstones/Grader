/**
 * Converting between RGB working spaces.
 *
 * A render in ACES primaries shown as sRGB is not subtly off — AP0 encloses the
 * whole spectral locus, so its red is far outside anything a monitor can show.
 * Read as sRGB the numbers land on much less saturated colours and the image
 * comes out flat and washed, which reads as a grade problem rather than a
 * missing transform.
 *
 * Matrices are derived here from chromaticities rather than pasted in, because
 * a pasted matrix cannot be checked against anything. Deriving them means the
 * white point a file actually declares is honoured, and the round trip is
 * testable.
 */

export type XY = readonly [number, number];

export interface Chromaticities {
  red: XY;
  green: XY;
  blue: XY;
  white: XY;
}

/** Row-major 3×3. GL wants column-major, so `toGl` transposes on the way out. */
export type Mat3 = readonly number[];

const D65: XY = [0.3127, 0.329];
/** ACES white, near enough to D60 that the two names get used for the same point. */
const D60: XY = [0.32168, 0.33767];

export const PRIMARIES: Record<string, Chromaticities> = {
  srgb: { red: [0.64, 0.33], green: [0.3, 0.6], blue: [0.15, 0.06], white: D65 },
  bt709: { red: [0.64, 0.33], green: [0.3, 0.6], blue: [0.15, 0.06], white: D65 },
  "display-p3": { red: [0.68, 0.32], green: [0.265, 0.69], blue: [0.15, 0.06], white: D65 },
  bt2020: { red: [0.708, 0.292], green: [0.17, 0.797], blue: [0.131, 0.046], white: D65 },
  // Blue y is negative on purpose: AP0 is deliberately larger than the visible
  // gamut so no real colour ever needs a negative component.
  "aces2065-1": { red: [0.7347, 0.2653], green: [0.0, 1.0], blue: [0.0001, -0.077], white: D60 },
  acescg: { red: [0.713, 0.293], green: [0.165, 0.83], blue: [0.128, 0.044], white: D60 },
};

function mul(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

function apply(m: Mat3, v: readonly number[]): number[] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

function invert(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) throw new Error("singular primaries matrix");
  return [
    (e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det,
    (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
    (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det,
  ];
}

/** xyY with Y = 1 → XYZ. */
function xyzOf([x, y]: XY): number[] {
  return [x / y, 1, (1 - x - y) / y];
}

/**
 * The RGB → XYZ matrix for a set of primaries.
 *
 * Standard construction: take the primaries as directions in XYZ, then solve
 * for the per-channel scale that makes (1,1,1) land exactly on the white point.
 */
export function rgbToXyz(c: Chromaticities): Mat3 {
  const r = xyzOf(c.red);
  const g = xyzOf(c.green);
  const b = xyzOf(c.blue);
  const basis: Mat3 = [r[0], g[0], b[0], r[1], g[1], b[1], r[2], g[2], b[2]];
  const scale = apply(invert(basis), xyzOf(c.white));
  return [
    r[0] * scale[0], g[0] * scale[1], b[0] * scale[2],
    r[1] * scale[0], g[1] * scale[1], b[1] * scale[2],
    r[2] * scale[0], g[2] * scale[1], b[2] * scale[2],
  ];
}

/** Bradford cone response — the adaptation everyone else's numbers assume. */
const BRADFORD: Mat3 = [
  0.8951, 0.2664, -0.1614,
  -0.7502, 1.7135, 0.0367,
  0.0389, -0.0685, 1.0296,
];

/**
 * Chromatic adaptation between white points.
 *
 * ACES is D60 and every display is D65. Skipping this leaves a visible warm
 * cast on anything graded in ACES — small next to the gamut error, but it is
 * the difference between "close" and "right".
 */
export function adapt(from: XY, to: XY): Mat3 {
  if (from[0] === to[0] && from[1] === to[1]) return IDENTITY;
  const src = apply(BRADFORD, xyzOf(from));
  const dst = apply(BRADFORD, xyzOf(to));
  const ratio: Mat3 = [dst[0] / src[0], 0, 0, 0, dst[1] / src[1], 0, 0, 0, dst[2] / src[2]];
  return mul(invert(BRADFORD), mul(ratio, BRADFORD));
}

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function same(a: Chromaticities, b: Chromaticities): boolean {
  const keys = ["red", "green", "blue", "white"] as const;
  return keys.every((k) => a[k][0] === b[k][0] && a[k][1] === b[k][1]);
}

/**
 * Source primaries → linear sRGB, white-adapted to D65.
 *
 * Identity for anything unrecognised. Guessing at an unknown gamut would be
 * worse than leaving it alone: at least untouched is a defined state the
 * colourist can reason about.
 */
export function toSrgbMatrix(primaries: string | undefined | null): Mat3 {
  if (!primaries) return IDENTITY;
  const source = PRIMARIES[primaries.toLowerCase()];
  if (!source) return IDENTITY;

  const srgb = PRIMARIES.srgb;
  // Exactly identity for the common case rather than identity-to-six-decimals.
  // Nearly every file is sRGB or Rec.709, and round-tripping those through two
  // matrix inversions to arrive at 0.9999997 is both slower and a worse answer.
  if (same(source, srgb)) return IDENTITY;

  const toXyz = mul(adapt(source.white, srgb.white), rgbToXyz(source));
  return mul(invert(rgbToXyz(srgb)), toXyz);
}

/** Row-major → the column-major order uniformMatrix3fv expects. */
export function toGl(m: Mat3): Float32Array {
  return new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
}
