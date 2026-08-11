/**
 * One textured quad. Flip, rotate, zoom, pan, colour transforms, channel
 * isolation and blend modes are all uniforms on this single program — which is
 * the whole reason the display layer is WebGL rather than a 2D canvas.
 */

export const VERT = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;      // unit quad, 0..1

uniform mat3 uView;      // media space -> clip space
uniform vec4 uRect;      // x, y, w, h of this draw in media pixels
uniform vec2 uFlip;      // (+1|-1, +1|-1)
uniform float uRotate;   // radians
uniform vec2 uMediaSize;

out vec2 vUv;

void main() {
  vUv = aPos;

  vec2 mediaPos = uRect.xy + aPos * uRect.zw;

  // Flip and rotate about the media centre so the image turns in place.
  vec2 c = uMediaSize * 0.5;
  vec2 p = mediaPos - c;
  p *= uFlip;
  float s = sin(uRotate);
  float co = cos(uRotate);
  p = vec2(p.x * co - p.y * s, p.x * s + p.y * co);
  p += c;

  vec3 clip = uView * vec3(p, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}`;

export const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uTex;
uniform sampler3D uLut;
uniform bool uHasLut;

uniform float uOpacity;
uniform float uExposure;     // stops
uniform float uGamma;
uniform float uSaturation;
uniform int uChannel;        // 0 rgb, 1 r, 2 g, 3 b, 4 a, 5 luma
uniform int uTransform;      // 0 native, 1 srgb, 2 display-p3, 3 rec709
uniform bool uFlipY;         // texture origin differs between sources
uniform int uBlend;          // see BLEND_* below
uniform bool uPremultiplied;

const mat3 SRGB_TO_P3 = mat3(
  0.8224621,  0.0331941,  0.0170827,
  0.1775380,  0.9668058,  0.0723974,
 -0.0000001,  0.0000000,  0.9105199
);

const mat3 P3_TO_SRGB = mat3(
  1.2249401, -0.0420569, -0.0196376,
 -0.2249404,  1.042057,  -0.0786361,
  0.0000000,  0.0000000,  1.0982735
);

float toLinear(float c) {
  return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}

float toSrgb(float c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

vec3 toLinear3(vec3 c) {
  return vec3(toLinear(c.r), toLinear(c.g), toLinear(c.b));
}

vec3 toSrgb3(vec3 c) {
  return vec3(toSrgb(c.r), toSrgb(c.g), toSrgb(c.b));
}

void main() {
  vec2 uv = uFlipY ? vec2(vUv.x, 1.0 - vUv.y) : vUv;
  vec4 texel = texture(uTex, uv);

  if (uPremultiplied && texel.a > 0.0) {
    texel.rgb /= texel.a;
  }

  vec3 c = texel.rgb;

  // Everything below happens in linear light — exposure and saturation in
  // gamma space are the classic way to get muddy, wrong-looking results.
  vec3 lin = toLinear3(clamp(c, 0.0, 1.0));

  lin *= pow(2.0, uExposure);

  if (uTransform == 2) {
    lin = SRGB_TO_P3 * lin;
  } else if (uTransform == 3) {
    // Rec.709 shares sRGB primaries; the difference is the transfer curve,
    // handled on the way back out.
    lin = lin;
  }

  float luma = dot(lin, vec3(0.2126, 0.7152, 0.0722));
  lin = mix(vec3(luma), lin, uSaturation);

  vec3 outRgb = toSrgb3(max(lin, 0.0));

  if (uGamma != 1.0) {
    outRgb = pow(max(outRgb, 0.0), vec3(1.0 / uGamma));
  }

  if (uHasLut) {
    outRgb = texture(uLut, clamp(outRgb, 0.0, 1.0)).rgb;
  }

  float a = texel.a;

  if (uChannel == 1) outRgb = vec3(outRgb.r);
  else if (uChannel == 2) outRgb = vec3(outRgb.g);
  else if (uChannel == 3) outRgb = vec3(outRgb.b);
  else if (uChannel == 4) { outRgb = vec3(a); a = 1.0; }
  else if (uChannel == 5) outRgb = vec3(toSrgb(luma));

  // Premultiplied output. This is what makes blend modes behave over
  // transparent regions: with straight alpha, a multiply blend darkens the
  // backdrop everywhere the layer is empty, so a disc on a transparent canvas
  // composites as a black square.
  float outA = a * uOpacity;
  outColor = vec4(outRgb * outA, outA);
}`;

/**
 * Blend modes reproducible exactly with premultiplied fixed-function blending.
 * Anything else falls back to normal and is flagged in the layer panel.
 */
export const BLEND = {
  normal: 0,
  multiply: 1,
  screen: 2,
  add: 3,
} as const;

export type BlendName = keyof typeof BLEND;

/**
 * PSD blend-mode keys as ag-psd reports them, mapped to what the GPU can do
 * with fixed-function blending. Non-separable modes (hue, saturation, color,
 * luminosity) need the full backdrop and are not reproducible this way — they
 * are marked unsupported at ingest so the layer panel can say so rather than
 * silently lying.
 */
export const PSD_BLEND_MAP: Record<string, BlendName> = {
  normal: "normal",
  dissolve: "normal",
  // Groups carry "pass through", which simply means "no group isolation" —
  // the normal case, not an unsupported mode.
  "pass through": "normal",
  passthrough: "normal",
  multiply: "multiply",
  screen: "screen",
  "linear dodge": "add",
  "linear dodge (add)": "add",
  add: "add",
};

/**
 * Modes that need the backdrop and cannot be done with fixed-function blending.
 * They render as normal, and the layer panel says so — a wrong composite that
 * looks plausible is worse than an honest approximation.
 */
export const NON_SEPARABLE_BLENDS = new Set([
  "hue",
  "saturation",
  "color",
  "luminosity",
  "overlay",
  "darken",
  "lighten",
  "difference",
  "soft light",
  "hard light",
  "vivid light",
  "linear light",
  "pin light",
  "hard mix",
  "exclusion",
  "subtract",
  "divide",
  "linear burn",
  "color burn",
  "color dodge",
  "darker color",
  "lighter color",
]);
