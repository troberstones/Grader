"use strict";
/**
 * Core value types. No DOM, no React, no grader — this file must stay importable
 * from a plain node test.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STROKE_TOOLS = exports.DEFAULT_VIEWER_STATE = exports.DEFAULT_COLOR_STATE = void 0;
exports.DEFAULT_COLOR_STATE = {
    transform: "srgb",
    exposure: 0,
    gamma: 1,
    saturation: 1,
    blur: 0,
    channel: "rgb",
    lut: null,
};
exports.DEFAULT_VIEWER_STATE = {
    itemIndex: 0,
    frame: 0,
    playing: false,
    rate: 1,
    loop: "loop",
    fps: 24,
    flipH: false,
    flipV: false,
    rotate: 0,
    zoom: 1,
    panX: 0,
    panY: 0,
    fit: "fit",
    color: exports.DEFAULT_COLOR_STATE,
    layers: {},
    soloLayer: null,
    composite: true,
    pauseOnAnnotated: false,
    ghostMs: 0,
    onionSkin: 0,
};
exports.STROKE_TOOLS = [
    "pen",
    "line",
    "arrow",
    "rect",
    "ellipse",
    "text",
    "highlight",
    "stamp",
];
