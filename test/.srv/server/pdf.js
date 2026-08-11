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
Object.defineProperty(exports, "__esModule", { value: true });
exports.pdfPageCount = pdfPageCount;
const promises_1 = require("node:fs/promises");
/**
 * Page count only.
 *
 * Rasterising server-side would be preferable — a PDF would become an ordinary
 * image sequence and the client would need no PDF code at all — but this
 * machine has no poppler, ghostscript or ImageMagick, and pdf.js cannot render
 * headless without a native canvas. So pages render in the browser and only the
 * count comes from here.
 */
async function pdfPageCount(input) {
    const data = await (0, promises_1.readFile)(input);
    try {
        const pdfjs = await Promise.resolve().then(() => __importStar(require("pdfjs-dist/legacy/build/pdf.mjs")));
        const doc = await pdfjs.getDocument({
            data: new Uint8Array(data),
            // Parsing needs neither worker nor fonts.
            useWorkerFetch: false,
            isEvalSupported: false,
            disableFontFace: true,
        }).promise;
        const n = doc.numPages;
        await doc.destroy();
        if (n > 0)
            return n;
    }
    catch {
        // Fall through to the structural scan.
    }
    // Crude but dependency-free: count page objects in the raw file. Good enough
    // to build a timeline; the real count arrives when pdf.js opens it client-side.
    const text = data.toString("latin1");
    const byCount = /\/Count\s+(\d+)/.exec(text);
    if (byCount) {
        const n = Number(byCount[1]);
        if (n > 0 && n < 10000)
            return n;
    }
    const matches = text.match(/\/Type\s*\/Page[^s]/g);
    return Math.max(1, matches?.length ?? 1);
}
