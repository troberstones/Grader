/**
 * What a file is from its first bytes, for files that arrive without a usable
 * extension — a student who renamed "render.png" to "render", or an LMS that
 * dropped the extension on the way into its bundle.
 *
 * Returns the extension (with the dot) the file should have, or null if the
 * bytes aren't a format this app can show. ".zip" is returned too, so a
 * nameless archive can still be unpacked. TGA has no signature and is never
 * detected. Needs at least the first 64 bytes, where there are that many.
 */
export const SNIFF_BYTES = 64;

export function sniffExtension(head: Uint8Array): string | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...head.subarray(start, end));
  const startsWith = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);

  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return ".png";
  if (startsWith(0xff, 0xd8, 0xff)) return ".jpg";
  if (startsWith(0x76, 0x2f, 0x31, 0x01)) return ".exr";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return ".gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return ".webp";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "AVI ") return ".avi";
  if (ascii(0, 4) === "II*\0" || ascii(0, 4) === "MM\0*") return ".tif";
  if (ascii(0, 4) === "8BPS") return head[5] === 2 ? ".psb" : ".psd";
  if (ascii(0, 4) === "%PDF") return ".pdf";
  if (ascii(0, 4) === "SDPX" || ascii(0, 4) === "XPDS") return ".dpx";
  if (startsWith(0x50, 0x4b, 0x03, 0x04)) return ".zip";
  if (startsWith(0x1a, 0x45, 0xdf, 0xa3)) return ascii(0, SNIFF_BYTES).includes("webm") ? ".webm" : ".mkv";
  if (startsWith(0x00, 0x00, 0x01, 0xba) || startsWith(0x00, 0x00, 0x01, 0xb3)) return ".mpg";

  const box = ascii(4, 8);
  if (box === "ftyp") return ascii(8, 12) === "qt  " ? ".mov" : ".mp4";
  // Older QuickTime files start straight in with a movie atom, no ftyp.
  if (box === "moov" || box === "mdat" || box === "wide" || box === "free" || box === "skip") return ".mov";

  // "BM" alone is too weak; the two reserved header words are always zero.
  if (ascii(0, 2) === "BM" && head.length >= 10 && head[6] === 0 && head[7] === 0 && head[8] === 0 && head[9] === 0) {
    return ".bmp";
  }
  return null;
}
