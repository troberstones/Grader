"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingestPsd = ingestPsd;
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const shaders_1 = require("../render/shaders");
/**
 * PSD/PSB ingest with a live layer stack.
 *
 * Parsing the file is the expensive step, not writing the rasters — so this
 * does one pass: composite, manifest, and every layer raster trimmed to its own
 * bounds. Re-reading a 500 MB PSD per layer request would be far worse than
 * writing the PNGs now, and trimming keeps the total bounded (most layers cover
 * a fraction of the canvas).
 *
 * Above the caps below, the file degrades to composite-only with the tree still
 * browsable rather than trying and failing.
 */
const MAX_LAYERS = 200;
const MAX_TOTAL_MEGAPIXELS = 600;
/**
 * ag-psd needs a `createImageData` factory even on the `useImageData` path.
 * In Node there is no canvas, but ImageData is structurally just a sized
 * Uint8ClampedArray — so supply that and leave `createCanvas` throwing, since
 * nothing on this path should reach it.
 */
function initHeadlessCanvas(initializeCanvas) {
    initializeCanvas(() => {
        throw new Error("psd: canvas rendering unavailable server-side (this file needs a path that avoids it)");
    }, (width, height) => ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
        colorSpace: "srgb",
    }));
}
async function ingestPsd(input, opts) {
    const [agPsd, sharpModule] = await Promise.all([Promise.resolve().then(() => __importStar(require("ag-psd"))), Promise.resolve().then(() => __importStar(require("sharp")))]);
    const { readPsd, initializeCanvas } = agPsd;
    initHeadlessCanvas(initializeCanvas);
    const sharp = sharpModule.default;
    await (0, promises_1.mkdir)(opts.outDir, { recursive: true });
    const buffer = await (0, promises_1.readFile)(input);
    // useImageData keeps this headless — the canvas-based path would need a
    // native canvas binding that this machine does not have.
    const psd = readPsd(buffer, {
        useImageData: true,
        skipThumbnail: true,
    });
    const width = psd.width;
    const height = psd.height;
    const warnings = [];
    const derivatives = [];
    // ── composite ───────────────────────────────────────────────────────────────
    const compositePath = node_path_1.default.join(opts.outDir, `${opts.baseName}.composite.png`);
    if (psd.imageData) {
        await sharp(Buffer.from(psd.imageData.data.buffer), {
            raw: { width: psd.imageData.width, height: psd.imageData.height, channels: 4 },
        })
            .png({ compressionLevel: 6 })
            .toFile(compositePath);
    }
    else {
        warnings.push("PSD has no flattened composite — save with 'Maximize Compatibility'");
    }
    derivatives.push({
        variant: "composite",
        idx: 0,
        path: compositePath,
        mime: "image/png",
        width,
        height,
    });
    // ── flatten the tree ────────────────────────────────────────────────────────
    const flat = [];
    let counter = 0;
    const walk = (nodes, depth, parentId) => {
        // PSD stores layers bottom-first; keep that order so drawing bottom-to-top
        // matches Photoshop's stack.
        for (const node of nodes) {
            const id = `l${counter++}`;
            flat.push({ node, depth, parentId, id });
            if (node.children?.length)
                walk(node.children, depth + 1, id);
        }
    };
    walk(psd.children ?? [], 0, null);
    let totalPixels = 0;
    for (const { node } of flat) {
        if (node.imageData)
            totalPixels += node.imageData.width * node.imageData.height;
    }
    const compositeOnly = flat.length > MAX_LAYERS || totalPixels / 1_000_000 > MAX_TOTAL_MEGAPIXELS;
    if (compositeOnly) {
        warnings.push(`${flat.length} layers / ${Math.round(totalPixels / 1_000_000)} MP exceeds the layer budget — composite only`);
    }
    // ── layer rasters + manifest ────────────────────────────────────────────────
    const layers = [];
    for (const { node, depth, parentId, id } of flat) {
        const isGroup = !!node.children?.length;
        const blendMode = (node.blendMode ?? "normal").toLowerCase();
        const left = node.left ?? 0;
        const top = node.top ?? 0;
        const right = node.right ?? left;
        const bottom = node.bottom ?? top;
        const isAdjustment = !!node.adjustment;
        let rasterUrl = null;
        if (!isGroup && !compositeOnly && node.imageData && right > left && bottom > top) {
            const file = node_path_1.default.join(opts.outDir, `${opts.baseName}.layer-${id}.png`);
            try {
                await sharp(Buffer.from(node.imageData.data.buffer), {
                    raw: {
                        width: node.imageData.width,
                        height: node.imageData.height,
                        channels: 4,
                    },
                })
                    .png({ compressionLevel: 6 })
                    .toFile(file);
                derivatives.push({
                    variant: "layer",
                    idx: layers.length,
                    path: file,
                    mime: "image/png",
                    width: node.imageData.width,
                    height: node.imageData.height,
                });
                rasterUrl = file; // rewritten to a URL by the host adapter
            }
            catch (e) {
                warnings.push(`layer "${node.name ?? id}" failed to rasterise`);
                void e;
            }
        }
        layers.push({
            id,
            name: node.name ?? "",
            depth,
            isGroup,
            parentId,
            visible: !node.hidden,
            opacity: node.opacity ?? 1,
            blendMode,
            bounds: [left, top, right, bottom],
            clipping: !!node.clipping,
            // Adjustment layers and smart filters are already in the composite and
            // cannot be re-applied client-side — say so rather than pretending.
            bakedIntoComposite: isAdjustment,
            blendUnsupported: shaders_1.NON_SEPARABLE_BLENDS.has(blendMode) || !(blendMode in shaders_1.PSD_BLEND_MAP),
            rasterUrl,
        });
    }
    const unsupported = layers.filter((l) => l.blendUnsupported && !l.isGroup).length;
    if (unsupported > 0) {
        warnings.push(`${unsupported} layer(s) use blend modes shown as normal in the stack view`);
    }
    const manifest = {
        itemId: opts.baseName,
        width,
        height,
        layers,
        compositeOnly,
        compositeUrl: compositePath,
    };
    const manifestPath = node_path_1.default.join(opts.outDir, `${opts.baseName}.layers.json`);
    const { writeFile } = await Promise.resolve().then(() => __importStar(require("node:fs/promises")));
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    derivatives.push({
        variant: "page",
        idx: -1,
        path: manifestPath,
        mime: "application/json",
    });
    return {
        kind: "layered",
        derivatives,
        width,
        height,
        frameCount: 1,
        fps: null,
        duration: null,
        warnings,
    };
}
