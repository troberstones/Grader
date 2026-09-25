/**
 * Shared ceiling for anything ingest decodes straight from raw pixel data
 * (PSD, EXR — formats where the decoder allocates a full-resolution buffer
 * up front rather than progressively). A tiny file can declare an enormous
 * canvas in its header — 30000x30000 is a ~3.4GB RGBA8 buffer, more once a
 * codec decodes into float — so callers must read width/height from the
 * file's own header and check them here *before* running the real decode,
 * not after.
 *
 * The numbers are generous for real art assets (16384px is already far past
 * anything a student or instructor's hardware produces) and tight enough to
 * fail fast on a crafted or corrupt header.
 */
export const MAX_IMAGE_DIMENSION = 16384;
export const MAX_IMAGE_MEGAPIXELS = 120;

/** Throws a clear, ingest-failure-worthy error if the header's dimensions are too large to decode safely. */
export function assertWithinImageLimits(width: number, height: number, label: string): void {
  const megapixels = (width * height) / 1_000_000;
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || megapixels > MAX_IMAGE_MEGAPIXELS) {
    throw new Error(
      `${label}: ${width}x${height} (${megapixels.toFixed(1)}MP) exceeds the ` +
        `${MAX_IMAGE_DIMENSION}px / ${MAX_IMAGE_MEGAPIXELS}MP decode limit`,
    );
  }
}
