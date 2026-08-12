import type { ColorState, Rotation, ViewTransform } from "../core/types";
import { toGl, toSrgbMatrix } from "../core/primaries";
import type { LayerDraw, TexSource } from "../sources/types";
import { BLEND, FRAG, PSD_BLEND_MAP, VERT, type BlendName } from "./shaders";

/**
 * WebGL2 display layer with an L1 texture cache.
 *
 * Context loss is a first-class path here, not defensive polish: the frame
 * cache deliberately operates near the browser's GPU cap, and exceeding it
 * fires `webglcontextlost` and drops every texture. The renderer must rebuild
 * without the viewer noticing anything beyond a dropped frame.
 */

export interface ViewParams {
  /** Canvas size in device pixels. */
  canvasWidth: number;
  canvasHeight: number;
  mediaWidth: number;
  mediaHeight: number;
  zoom: number;
  panX: number;
  panY: number;
  flipH: boolean;
  flipV: boolean;
  rotate: Rotation;
  color: ColorState;
  /**
   * The working space the item's pixels are in, as ingest named it. Per frame
   * rather than per draw because every draw in a frame — including a PSD's
   * layer stack — comes from the same file.
   */
  sourcePrimaries?: string;
}

interface CachedTexture {
  tex: WebGLTexture;
  width: number;
  height: number;
  /**
   * Actual VRAM footprint. Carried rather than recomputed as w*h*4: an HDR
   * still uploads as RGBA16F at 8 bytes a pixel, and undercounting it would
   * let the resident set drift past vramBudget — which is what provokes the
   * context loss this cache exists to avoid.
   */
  bytes: number;
  version: number;
  lastUsed: number;
}

const TRANSFORM_INDEX: Record<ViewTransform, number> = {
  native: 0,
  srgb: 1,
  "display-p3": 2,
  rec709: 3,
};

const CHANNEL_INDEX: Record<ColorState["channel"], number> = {
  rgb: 0,
  r: 1,
  g: 2,
  b: 3,
  a: 4,
  luma: 5,
};

export class GLRenderer {
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private textures = new Map<string, CachedTexture>();
  private lutTexture: WebGLTexture | null = null;
  private clock = 0;
  private lostHandler: (() => void) | null = null;
  private restoredHandler: (() => void) | null = null;
  private onLost: (() => void) | null = null;
  private textureBytes = 0;
  /**
   * True when the drawing buffer really is Display-P3, so the shader has to
   * encode into P3 primaries rather than sRGB. Read back from the context
   * rather than assumed — see init().
   */
  private outputP3 = false;

  /** Bytes of texture memory to keep resident before evicting. */
  vramBudget = 1024 * 1024 * 1024;

  constructor(private canvas: HTMLCanvasElement) {}

  init(onContextLost?: () => void): boolean {
    this.onLost = onContextLost ?? null;

    const gl = this.canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) return false;
    this.gl = gl;

    // Display-P3 where the browser supports it; sRGB is the silent fallback.
    //
    // Whether it took has to be read back, not assumed: the shader encodes into
    // whatever space this ends up being, and guessing wrong stretches the whole
    // gamut. Asking for P3 and then writing sRGB-encoded values is exactly the
    // bug this flag exists to prevent — it renders every image oversaturated on
    // the machines that support the wider gamut, which is all of them here.
    try {
      const withSpace = gl as WebGL2RenderingContext & { drawingBufferColorSpace?: string };
      if ("drawingBufferColorSpace" in gl) {
        withSpace.drawingBufferColorSpace = "display-p3";
        this.outputP3 = withSpace.drawingBufferColorSpace === "display-p3";
      }
    } catch {
      // Not supported — sRGB it is.
      this.outputP3 = false;
    }

    this.lostHandler = () => {
      // Preventing the default is what makes restoration possible at all.
      this.textures.clear();
      this.textureBytes = 0;
      this.onLost?.();
    };
    this.restoredHandler = () => {
      this.buildProgram();
    };
    this.canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lostHandler?.();
    });
    this.canvas.addEventListener("webglcontextrestored", () => this.restoredHandler?.());

    return this.buildProgram();
  }

  get contextLost(): boolean {
    return !this.gl || this.gl.isContextLost();
  }

  private buildProgram(): boolean {
    const gl = this.gl;
    if (!gl) return false;

    const compile = (type: number, src: string): WebGLShader | null => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error("art-review shader:", gl.getShaderInfoLog(sh));
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    };

    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return false;

    const prog = gl.createProgram();
    if (!prog) return false;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("art-review link:", gl.getProgramInfoLog(prog));
      return false;
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.program = prog;

    for (const name of [
      "uView", "uRect", "uFlip", "uRotate", "uMediaSize", "uTex", "uLut", "uHasLut",
      "uOpacity", "uExposure", "uGamma", "uSaturation", "uChannel", "uTransform",
      "uOutputP3", "uLinearSource", "uPrimaries", "uFlipY", "uBlend", "uPremultiplied",
    ]) {
      this.uniforms[name] = gl.getUniformLocation(prog, name);
    }

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.vao = vao;

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    return true;
  }

  /**
   * media-space → clip-space matrix (column-major for WebGL).
   * The image is centred, scaled to fit, then zoomed and panned.
   */
  /**
   * The working-space matrix for this frame, memoised on the space's name —
   * deriving it costs two 3×3 inversions, and it changes only when the item
   * does, not 60 times a second.
   */
  private primariesCache: { name: string; m: Float32Array } | null = null;

  private primariesMatrix(name: string | undefined): Float32Array {
    const key = name ?? "";
    if (this.primariesCache?.name !== key) {
      this.primariesCache = { name: key, m: toGl(toSrgbMatrix(name)) };
    }
    return this.primariesCache.m;
  }

  private viewMatrix(p: ViewParams): Float32Array {
    const fitScale = Math.min(
      p.canvasWidth / Math.max(1, p.mediaWidth),
      p.canvasHeight / Math.max(1, p.mediaHeight),
    );
    const s = fitScale * p.zoom;
    const cx = p.canvasWidth / 2 + p.panX;
    const cy = p.canvasHeight / 2 + p.panY;

    // media px → screen px
    const a = s;
    const tx = cx - (p.mediaWidth / 2) * s;
    const ty = cy - (p.mediaHeight / 2) * s;

    // screen px → clip (-1..1, y up)
    const sx = 2 / p.canvasWidth;
    const sy = -2 / p.canvasHeight;

    return new Float32Array([
      a * sx, 0, 0,
      0, a * sy, 0,
      tx * sx - 1, ty * sy + 1, 1,
    ]);
  }

  /** Screen point → media point, for hit-testing and drawing. */
  static screenToMedia(p: ViewParams, x: number, y: number): { x: number; y: number } {
    const fitScale = Math.min(
      p.canvasWidth / Math.max(1, p.mediaWidth),
      p.canvasHeight / Math.max(1, p.mediaHeight),
    );
    const s = fitScale * p.zoom;
    const cx = p.canvasWidth / 2 + p.panX;
    const cy = p.canvasHeight / 2 + p.panY;

    let mx = (x - cx) / s;
    let my = (y - cy) / s;

    // Undo rotation, then flip — the inverse of the vertex shader's order.
    if (p.rotate) {
      const r = (-p.rotate * Math.PI) / 180;
      const c = Math.cos(r);
      const sn = Math.sin(r);
      const rx = mx * c - my * sn;
      const ry = mx * sn + my * c;
      mx = rx;
      my = ry;
    }
    if (p.flipH) mx = -mx;
    if (p.flipV) my = -my;

    return { x: mx + p.mediaWidth / 2, y: my + p.mediaHeight / 2 };
  }

  /** Media point → screen point. */
  static mediaToScreen(p: ViewParams, x: number, y: number): { x: number; y: number } {
    const fitScale = Math.min(
      p.canvasWidth / Math.max(1, p.mediaWidth),
      p.canvasHeight / Math.max(1, p.mediaHeight),
    );
    const s = fitScale * p.zoom;
    let mx = x - p.mediaWidth / 2;
    let my = y - p.mediaHeight / 2;

    if (p.flipH) mx = -mx;
    if (p.flipV) my = -my;
    if (p.rotate) {
      const r = (p.rotate * Math.PI) / 180;
      const c = Math.cos(r);
      const sn = Math.sin(r);
      const rx = mx * c - my * sn;
      const ry = mx * sn + my * c;
      mx = rx;
      my = ry;
    }

    return {
      x: mx * s + p.canvasWidth / 2 + p.panX,
      y: my * s + p.canvasHeight / 2 + p.panY,
    };
  }

  private uploadTexture(key: string, src: TexSource, version: number): WebGLTexture | null {
    const gl = this.gl;
    if (!gl) return null;

    const existing = this.textures.get(key);
    // A <video> element's pixels change under a stable key, so it re-uploads
    // every frame; everything else is content-addressed by version.
    if (existing && existing.version === version && src.type !== "video") {
      existing.lastUsed = ++this.clock;
      return existing.tex;
    }

    const tex = existing?.tex ?? gl.createTexture();
    if (!tex) return null;

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    let bytes = 0;
    try {
      if (src.type === "half") {
        // RGBA16F is filterable in core WebGL2 — no extension needed — which is
        // what lets an HDR still be scaled and zoomed like any other.
        gl.texImage2D(
          gl.TEXTURE_2D, 0, gl.RGBA16F, src.width, src.height, 0,
          gl.RGBA, gl.HALF_FLOAT, src.data,
        );
        bytes = src.width * src.height * 8;
      } else if (src.type === "pixels") {
        const format = src.channels === 3 ? gl.RGB : gl.RGBA;
        const internal = src.channels === 3 ? gl.RGB8 : gl.RGBA8;
        gl.texImage2D(
          gl.TEXTURE_2D, 0, internal, src.width, src.height, 0,
          format, gl.UNSIGNED_BYTE, src.data,
        );
        bytes = src.width * src.height * 4;
      } else {
        const el = src.type === "bitmap" ? src.bitmap : src.video;
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, el);
        bytes = src.width * src.height * 4;
      }
    } catch (e) {
      console.warn("art-review: texture upload failed", e);
      return null;
    }

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    if (existing) this.textureBytes -= existing.bytes;
    this.textures.set(key, {
      tex,
      width: src.width,
      height: src.height,
      bytes,
      version,
      lastUsed: ++this.clock,
    });
    this.textureBytes += bytes;
    this.evictTextures();
    return tex;
  }

  /** LRU down to the VRAM budget — the ceiling that keeps context loss rare. */
  private evictTextures(): void {
    const gl = this.gl;
    if (!gl) return;
    while (this.textureBytes > this.vramBudget && this.textures.size > 1) {
      let oldestKey: string | null = null;
      let oldest = Infinity;
      for (const [k, v] of this.textures) {
        if (v.lastUsed < oldest) {
          oldest = v.lastUsed;
          oldestKey = k;
        }
      }
      if (!oldestKey) break;
      const victim = this.textures.get(oldestKey)!;
      gl.deleteTexture(victim.tex);
      this.textureBytes -= victim.bytes;
      this.textures.delete(oldestKey);
    }
  }

  get vramUsed(): number {
    return this.textureBytes;
  }

  /**
   * Blend functions assuming a PREMULTIPLIED source (see the fragment shader).
   *
   * Only the modes that are exactly reproducible with fixed-function blending
   * live here. MIN/MAX equations (darken, lighten) and reverse-subtract
   * (difference) cannot be made alpha-correct without the backdrop — over a
   * transparent region they collapse to black — so those are reported as
   * unsupported at ingest and drawn as normal rather than drawn wrongly.
   */
  private setBlend(name: BlendName): void {
    const gl = this.gl;
    if (!gl) return;
    gl.blendEquation(gl.FUNC_ADD);
    switch (name) {
      case "multiply":
        // dst·(src + 1 − a): full multiply where opaque, untouched where empty.
        gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        break;
      case "screen":
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        break;
      case "add":
        gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        break;
      case "normal":
      default:
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        break;
    }
  }

  beginFrame(p: ViewParams, background: [number, number, number, number] = [0.06, 0.06, 0.06, 1]) {
    const gl = this.gl;
    if (!gl || !this.program) return;
    if (this.canvas.width !== p.canvasWidth || this.canvas.height !== p.canvasHeight) {
      this.canvas.width = p.canvasWidth;
      this.canvas.height = p.canvasHeight;
    }
    gl.viewport(0, 0, p.canvasWidth, p.canvasHeight);
    gl.clearColor(...background);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    const u = this.uniforms;
    gl.uniformMatrix3fv(u.uView!, false, this.viewMatrix(p));
    gl.uniform2f(u.uFlip!, p.flipH ? -1 : 1, p.flipV ? -1 : 1);
    gl.uniform1f(u.uRotate!, (p.rotate * Math.PI) / 180);
    gl.uniform2f(u.uMediaSize!, p.mediaWidth, p.mediaHeight);
    gl.uniform1f(u.uExposure!, p.color.exposure);
    gl.uniform1f(u.uGamma!, p.color.gamma);
    gl.uniform1f(u.uSaturation!, p.color.saturation);
    gl.uniform1i(u.uChannel!, CHANNEL_INDEX[p.color.channel] ?? 0);
    // uTransform is currently optimised out of the program — the shader stopped
    // referencing it when the buffer-space conversion replaced the branch that
    // used to stand in for it, so getUniformLocation returns null and this call
    // is a no-op. Kept because view-transform simulation is the next slice of
    // the colour work and it will read this again; see shaders.ts.
    gl.uniform1i(u.uTransform!, TRANSFORM_INDEX[p.color.transform] ?? 1);
    gl.uniform1i(u.uOutputP3!, this.outputP3 ? 1 : 0);
    gl.uniformMatrix3fv(u.uPrimaries!, false, this.primariesMatrix(p.sourcePrimaries));
    gl.uniform1i(u.uTex!, 0);
    gl.uniform1i(u.uLut!, 1);
    gl.uniform1i(u.uHasLut!, this.lutTexture ? 1 : 0);

    if (this.lutTexture) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, this.lutTexture);
    }
  }

  /**
   * Draw one texture into a media-space rect.
   * `key` identifies the texture in the L1 cache; `version` invalidates it.
   */
  draw(
    key: string,
    src: TexSource,
    version: number,
    rect: { x: number; y: number; w: number; h: number },
    opts: { opacity?: number; blend?: BlendName; premultiplied?: boolean } = {},
  ): void {
    const gl = this.gl;
    if (!gl || !this.program) return;

    const tex = this.uploadTexture(key, src, version);
    if (!tex) return;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);

    const u = this.uniforms;
    gl.uniform4f(u.uRect!, rect.x, rect.y, rect.w, rect.h);
    gl.uniform1f(u.uOpacity!, opts.opacity ?? 1);
    gl.uniform1i(u.uFlipY!, 0);
    gl.uniform1i(u.uBlend!, BLEND[opts.blend ?? "normal"]);
    gl.uniform1i(u.uPremultiplied!, opts.premultiplied ? 1 : 0);
    // Per draw, not per frame: a playlist can hold an HDR still next to an
    // ordinary 8-bit one, and the flip decides whether the texels get an sRGB
    // decode or are taken as linear light.
    gl.uniform1i(u.uLinearSource!, src.type === "half" ? 1 : 0);

    this.setBlend(opts.blend ?? "normal");
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** Draw a PSD layer stack bottom-to-top with per-layer blend modes. */
  drawLayers(layers: LayerDraw[], version: number): void {
    for (const l of layers) {
      const blend = PSD_BLEND_MAP[l.layer.blendMode?.toLowerCase() ?? "normal"] ?? "normal";
      this.draw(`layer:${l.layer.id}`, l.tex, version, { x: l.x, y: l.y, w: l.w, h: l.h }, {
        opacity: l.layer.opacity,
        blend,
      });
    }
  }

  /** Upload a parsed .cube LUT. `size` is the cube edge length. */
  setLut(data: Float32Array | null, size: number): void {
    const gl = this.gl;
    if (!gl) return;
    if (this.lutTexture) {
      gl.deleteTexture(this.lutTexture);
      this.lutTexture = null;
    }
    if (!data) return;

    const tex = gl.createTexture();
    if (!tex) return;
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texImage3D(
      gl.TEXTURE_3D, 0, gl.RGB16F, size, size, size, 0, gl.RGB, gl.FLOAT, data,
    );
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    this.lutTexture = tex;
  }

  /** Drop cached textures for an item that is no longer on screen. */
  purge(prefix: string): void {
    const gl = this.gl;
    if (!gl) return;
    for (const [k, v] of [...this.textures]) {
      if (!k.startsWith(prefix)) continue;
      gl.deleteTexture(v.tex);
      this.textureBytes -= v.bytes;
      this.textures.delete(k);
    }
  }

  dispose(): void {
    const gl = this.gl;
    if (!gl) return;
    for (const v of this.textures.values()) gl.deleteTexture(v.tex);
    this.textures.clear();
    this.textureBytes = 0;
    if (this.lutTexture) gl.deleteTexture(this.lutTexture);
    if (this.program) gl.deleteProgram(this.program);
    this.gl = null;
  }
}

/** Parse an Adobe .cube LUT into the layout setLut() expects. */
export function parseCubeLut(text: string): { data: Float32Array; size: number } | null {
  const lines = text.split(/\r?\n/);
  let size = 0;
  const values: number[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("LUT_3D_SIZE")) {
      size = parseInt(line.split(/\s+/)[1], 10);
      continue;
    }
    if (/^[A-Z_]/.test(line)) continue;
    const parts = line.split(/\s+/).map(Number);
    if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
      values.push(parts[0], parts[1], parts[2]);
    }
  }
  if (!size || values.length !== size * size * size * 3) return null;
  return { data: new Float32Array(values), size };
}
