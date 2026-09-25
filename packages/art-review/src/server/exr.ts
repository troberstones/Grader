import { EXRLoader } from "./vendor/exr-loader";

/**
 * EXR → linear float, via the vendored three.js decoder.
 *
 * ffmpeg is not usable for this. It decodes a half-float EXR fine, but cannot
 * write any 16-bit float pixel format, so getting the samples out means a
 * conversion, and conversions go through swscale — which clamps float to
 * [0,1]. Half is the ordinary choice for a render, so that quietly threw away
 * the highlight range on most files while looking like it had worked.
 */

export interface DecodedExr {
  width: number;
  height: number;
  /** Interleaved RGBA, linear, unbounded above 1. */
  data: Float32Array;
  /** Chromaticities as the file declares them, if it declares them at all. */
  chromaticities?: {
    redX: number; redY: number;
    greenX: number; greenY: number;
    blueX: number; blueY: number;
    whiteX: number; whiteY: number;
  };
  compression: number;
  channels: string[];
}

/** three.js FloatType — asking for float output rather than half. */
const FLOAT_TYPE = 1015;

/** The upstream file is @ts-nocheck'd, so its shape is asserted here once. */
interface ExrHeader {
  chromaticities?: DecodedExr["chromaticities"];
  compression?: number;
  channels?: Record<string, unknown>;
}

/**
 * Reads just the canvas size out of an EXR header, without decoding a single
 * scanline.
 *
 * The vendored loader's `parse()` allocates the full-resolution float buffer
 * (and does the real decompression work) as part of parsing — there is no
 * cheap partial-parse entry point in it. A file's `dataWindow` attribute
 * (its pixel bounds) is a fixed, well-documented part of the attribute list
 * that starts right after the 8-byte magic+version, so it's read here by
 * hand: cheap, and lets a caller reject an absurd size before the real
 * decoder ever runs.
 */
export function peekExrDimensions(buffer: ArrayBuffer): { width: number; height: number } {
  const view = new DataView(buffer);
  if (buffer.byteLength < 8 || view.getUint32(0, true) !== 0x01312f76) {
    throw new Error("exr: bad magic number");
  }

  const readCString = (offset: number): { value: string; next: number } => {
    let end = offset;
    while (end < view.byteLength && view.getUint8(end) !== 0) end++;
    if (end >= view.byteLength) throw new Error("exr: truncated header");
    const bytes = new Uint8Array(buffer, offset, end - offset);
    return { value: new TextDecoder().decode(bytes), next: end + 1 };
  };

  let offset = 8; // past magic (4) + version (4)
  while (offset < view.byteLength) {
    const name = readCString(offset);
    if (name.value === "") break; // zero-length name terminates the attribute list
    const type = readCString(name.next);
    const size = view.getInt32(type.next, true);
    const dataOffset = type.next + 4;
    if (name.value === "dataWindow" && type.value === "box2i" && size >= 16) {
      const xMin = view.getInt32(dataOffset, true);
      const yMin = view.getInt32(dataOffset + 4, true);
      const xMax = view.getInt32(dataOffset + 8, true);
      const yMax = view.getInt32(dataOffset + 12, true);
      return { width: xMax - xMin + 1, height: yMax - yMin + 1 };
    }
    offset = dataOffset + size;
  }
  throw new Error("exr: no dataWindow attribute in header");
}

export function decodeExr(buffer: ArrayBuffer): DecodedExr {
  const loader = new EXRLoader(undefined);
  loader.setDataType(FLOAT_TYPE);
  const out = loader.parse(buffer) as {
    header: ExrHeader;
    width: number;
    height: number;
    data: unknown;
  };

  const { header, width, height, data } = out;
  if (!(data instanceof Float32Array)) {
    throw new Error("EXR decoded to something other than float");
  }

  return {
    width,
    height,
    data,
    chromaticities: header?.chromaticities,
    compression: header?.compression ?? -1,
    channels: Object.keys(header?.channels ?? {}),
  };
}
