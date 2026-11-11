import { describe, expect, it } from "vitest";
import { sniffExtension } from "./sniff";

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

describe("sniffExtension", () => {
  it.each([
    [".png", bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], "IHDR")],
    [".jpg", bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16], "JFIF")],
    [".exr", bytes([0x76, 0x2f, 0x31, 0x01, 2, 0, 0, 0])],
    [".gif", bytes("GIF89a")],
    [".webp", bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 ")],
    [".tif", bytes("II*", [0])],
    [".psd", bytes("8BPS", [0, 1])],
    [".pdf", bytes("%PDF-1.7")],
    [".zip", bytes("PK", [3, 4])],
    [".mp4", bytes([0, 0, 0, 32], "ftypisom")],
    [".mov", bytes([0, 0, 0, 20], "ftypqt  ")],
    [".webm", bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81], "webm")],
    [".bmp", bytes("BM", [0x36, 0, 0, 0, 0, 0, 0, 0])],
  ])("detects %s", (ext, head) => {
    expect(sniffExtension(head)).toBe(ext);
  });

  it("returns null for text and Blender files", () => {
    expect(sniffExtension(bytes("hello world"))).toBeNull();
    expect(sniffExtension(bytes("BLENDER-v300"))).toBeNull();
    expect(sniffExtension(new Uint8Array())).toBeNull();
  });
});
