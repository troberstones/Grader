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
