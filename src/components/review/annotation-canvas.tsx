"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { AnnotationTool } from "./annotation-toolbar";

// ── Ramer–Douglas–Peucker stroke simplification ──────────────────────────────
function _perpDist(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function rdpSimplify(
  pts: { x: number; y: number }[],
  epsilon: number
): { x: number; y: number }[] {
  if (pts.length <= 2) return pts;
  let maxD = 0;
  let maxI = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = _perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) { maxD = d; maxI = i; }
  }
  if (maxD > epsilon) {
    return [
      ...rdpSimplify(pts.slice(0, maxI + 1), epsilon).slice(0, -1),
      ...rdpSimplify(pts.slice(maxI), epsilon),
    ];
  }
  return [pts[0], pts[pts.length - 1]];
}

export interface AnnotationCanvasHandle {
  loadFrame: (json: string | null) => Promise<boolean>;
  getCurrentJSON: () => string | null;
  undo: () => void;
  clear: () => void;
  hasContent: () => boolean;
}

interface AnnotationCanvasProps {
  width: number;
  height: number;
  tool: AnnotationTool;
  color: string;
  strokeWidth: number;
  onDirty: () => void;
  onReady?: () => void;
}

export const AnnotationCanvas = forwardRef<AnnotationCanvasHandle, AnnotationCanvasProps>(
  function AnnotationCanvas({ width, height, tool, color, strokeWidth, onDirty, onReady }, ref) {
    const canvasElRef = useRef<HTMLCanvasElement>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fabricRef = useRef<any>(null);
    const undoStackRef = useRef<string[]>([]);
    const suppressHistoryRef = useRef(false);
    // Shape drawing state
    const isDrawingShapeRef = useRef(false);
    const shapeStartRef = useRef({ x: 0, y: 0 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const activeShapeRef = useRef<any>(null);

    // Keep latest prop values accessible inside async init without stale closure
    const toolRef = useRef(tool);
    const colorRef = useRef(color);
    const strokeWidthRef = useRef(strokeWidth);
    useEffect(() => { toolRef.current = tool; }, [tool]);
    useEffect(() => { colorRef.current = color; }, [color]);
    useEffect(() => { strokeWidthRef.current = strokeWidth; }, [strokeWidth]);

    // ── Imperative API ────────────────────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      loadFrame: async (json: string | null) => {
        const canvas = fabricRef.current;
        if (!canvas) return false; // canvas not ready yet — caller should retry via onReady
        suppressHistoryRef.current = true;
        undoStackRef.current = [];
        canvas.clear();
        if (json) {
          try {
            const parsed = typeof json === "string" ? JSON.parse(json) : json;
            await canvas.loadFromJSON(parsed);
            canvas.renderAll();
          } catch {
            // ignore malformed JSON
          }
        }
        suppressHistoryRef.current = false;
        return true;
      },
      getCurrentJSON: () => {
        const canvas = fabricRef.current;
        if (!canvas) return null;
        const json = canvas.toJSON();
        if (!json.objects || json.objects.length === 0) return null;
        return JSON.stringify(json);
      },
      undo: () => {
        const canvas = fabricRef.current;
        if (!canvas || undoStackRef.current.length === 0) return;
        suppressHistoryRef.current = true;
        const prev = undoStackRef.current.pop()!;
        canvas.loadFromJSON(JSON.parse(prev)).then(() => {
          canvas.renderAll();
          suppressHistoryRef.current = false;
        });
      },
      clear: () => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        pushHistory();
        canvas.clear();
        canvas.renderAll();
        onDirty();
      },
      hasContent: () => {
        const canvas = fabricRef.current;
        if (!canvas) return false;
        return (canvas.getObjects?.() ?? []).length > 0;
      },
    }));

    function pushHistory() {
      const canvas = fabricRef.current;
      if (!canvas || suppressHistoryRef.current) return;
      undoStackRef.current.push(JSON.stringify(canvas.toJSON()));
      if (undoStackRef.current.length > 50) undoStackRef.current.shift();
    }

    // ── Initialize Fabric.js ──────────────────────────────────────────────────
    useEffect(() => {
      if (!canvasElRef.current || width === 0 || height === 0) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let canvas: any;
      let cancelled = false;

      const init = async () => {
        const fabric = await import("fabric");

        if (cancelled || !canvasElRef.current) return;

        canvas = new fabric.Canvas(canvasElRef.current, {
          width,
          height,
          isDrawingMode: false,
          selection: false,
        });

        fabricRef.current = canvas;

        // Brush setup
        const brush = new fabric.PencilBrush(canvas);
        brush.color = colorRef.current;
        brush.width = strokeWidthRef.current;
        canvas.freeDrawingBrush = brush;

        // Apply current tool immediately so drawing works without needing to toggle
        canvas.isDrawingMode = toolRef.current === "pen";
        canvas.selection = toolRef.current === "select";

        // History events
        canvas.on("path:created", (e: any) => {
          onDirty();
          // Simplify the path using Ramer–Douglas–Peucker (2.5px tolerance)
          const path = e.path;
          if (!path?.path || path.path.length < 4) return;
          // Extract the endpoint of every SVG command as the point set
          const pts: { x: number; y: number }[] = (path.path as any[][]).map((cmd) => ({
            x: cmd[cmd.length - 2] as number,
            y: cmd[cmd.length - 1] as number,
          }));
          const simplified = rdpSimplify(pts, 2.5);
          if (simplified.length >= pts.length) return; // nothing to reduce
          // Rebuild as smooth quadratic-bezier path using the midpoint algorithm
          // (identical to what PencilBrush generates, so the stroke stays smooth)
          const newPath: any[][] = [["M", simplified[0].x, simplified[0].y]];
          for (let i = 1; i < simplified.length - 1; i++) {
            const c = simplified[i];
            const n = simplified[i + 1];
            newPath.push(["Q", c.x, c.y, (c.x + n.x) / 2, (c.y + n.y) / 2]);
          }
          newPath.push(["L", simplified[simplified.length - 1].x, simplified[simplified.length - 1].y]);
          path.path = newPath;
          path.setCoords?.();
          canvas.renderAll();
        });
        canvas.on("object:added", () => { if (!suppressHistoryRef.current) onDirty(); });
        canvas.on("object:modified", () => { if (!suppressHistoryRef.current) onDirty(); });
        canvas.on("object:removed", () => { if (!suppressHistoryRef.current) onDirty(); });

        // Signal that canvas is ready — parent can now call loadFrame
        onReady?.();
      };

      init();

      return () => {
        cancelled = true;
        canvas?.dispose();
        fabricRef.current = null;
        undoStackRef.current = [];
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [width, height]);

    // ── Update tool ───────────────────────────────────────────────────────────
    useEffect(() => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      canvas.off("mouse:down");
      canvas.off("mouse:move");
      canvas.off("mouse:up");
      isDrawingShapeRef.current = false;
      activeShapeRef.current = null;

      canvas.isDrawingMode = tool === "pen";
      canvas.selection = tool === "select";
      canvas.getObjects?.().forEach((obj: any) => { obj.selectable = tool === "select"; });

      if (tool === "pen") {
        if (canvas.freeDrawingBrush) {
          canvas.freeDrawingBrush.color = color;
          canvas.freeDrawingBrush.width = strokeWidth;
        }
        return;
      }

      if (tool === "text") {
        canvas.on("mouse:down", async (opt: any) => {
          const fabric = await import("fabric");
          const ptr = canvas.getViewportPoint(opt.e);
          pushHistory();
          const text = new fabric.IText("Edit text", {
            left: ptr.x,
            top: ptr.y,
            fill: color,
            fontSize: 18,
            fontFamily: "Arial, sans-serif",
            editable: true,
          });
          canvas.add(text);
          canvas.setActiveObject(text);
          text.enterEditing?.();
          text.selectAll?.();
          canvas.renderAll();
        });
        return;
      }

      if (tool === "rect" || tool === "circle" || tool === "arrow") {
        canvas.on("mouse:down", async (opt: any) => {
          if (opt.target) return; // clicked on existing object in select mode
          const fabric = await import("fabric");
          const ptr = canvas.getViewportPoint(opt.e);
          pushHistory();
          isDrawingShapeRef.current = true;
          shapeStartRef.current = { x: ptr.x, y: ptr.y };

          const shapeOpts = {
            left: ptr.x,
            top: ptr.y,
            fill: "transparent",
            stroke: color,
            strokeWidth,
            selectable: false,
            evented: false,
          };

          if (tool === "rect") {
            activeShapeRef.current = new fabric.Rect({ ...shapeOpts, width: 0, height: 0 });
          } else if (tool === "circle") {
            activeShapeRef.current = new fabric.Ellipse({ ...shapeOpts, rx: 0, ry: 0, originX: "left", originY: "top" });
          } else if (tool === "arrow") {
            // Arrow: a Line
            activeShapeRef.current = new fabric.Line(
              [ptr.x, ptr.y, ptr.x, ptr.y],
              { ...shapeOpts, strokeLineCap: "round" }
            );
          }
          if (activeShapeRef.current) canvas.add(activeShapeRef.current);
        });

        canvas.on("mouse:move", (opt: any) => {
          if (!isDrawingShapeRef.current || !activeShapeRef.current) return;
          const ptr = canvas.getViewportPoint(opt.e);
          const dx = ptr.x - shapeStartRef.current.x;
          const dy = ptr.y - shapeStartRef.current.y;

          if (tool === "rect") {
            activeShapeRef.current.set({
              width: Math.abs(dx),
              height: Math.abs(dy),
              left: dx < 0 ? ptr.x : shapeStartRef.current.x,
              top: dy < 0 ? ptr.y : shapeStartRef.current.y,
            });
          } else if (tool === "circle") {
            activeShapeRef.current.set({
              rx: Math.abs(dx) / 2,
              ry: Math.abs(dy) / 2,
              left: dx < 0 ? ptr.x : shapeStartRef.current.x,
              top: dy < 0 ? ptr.y : shapeStartRef.current.y,
            });
          } else if (tool === "arrow") {
            activeShapeRef.current.set({ x2: ptr.x, y2: ptr.y });
          }
          canvas.renderAll();
        });

        canvas.on("mouse:up", async (opt: any) => {
          if (!isDrawingShapeRef.current) return;
          isDrawingShapeRef.current = false;
          const ptr = canvas.getViewportPoint(opt.e);
          const dx = ptr.x - shapeStartRef.current.x;
          const dy = ptr.y - shapeStartRef.current.y;

          // Discard tiny accidental clicks
          if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
            if (activeShapeRef.current) canvas.remove(activeShapeRef.current);
            activeShapeRef.current = null;
            undoStackRef.current.pop(); // remove the history push from mouse:down
            return;
          }

          if (tool === "arrow") {
            // Add arrowhead
            const fabric = await import("fabric");
            const x1 = shapeStartRef.current.x;
            const y1 = shapeStartRef.current.y;
            const angle = Math.atan2(ptr.y - y1, ptr.x - x1);
            const hLen = Math.min(20, Math.hypot(dx, dy) * 0.3);
            const headPath = `M ${ptr.x} ${ptr.y} L ${ptr.x - hLen * Math.cos(angle - 0.5)} ${ptr.y - hLen * Math.sin(angle - 0.5)} L ${ptr.x - hLen * Math.cos(angle + 0.5)} ${ptr.y - hLen * Math.sin(angle + 0.5)} Z`;
            const head = new fabric.Path(headPath, {
              fill: color,
              stroke: color,
              strokeWidth: 1,
              selectable: false,
              evented: false,
            });
            canvas.add(head);
          }

          activeShapeRef.current = null;
          canvas.renderAll();
        });
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tool, color, strokeWidth]);

    // ── Update brush color / width without reinit ─────────────────────────────
    useEffect(() => {
      const canvas = fabricRef.current;
      if (!canvas?.freeDrawingBrush) return;
      canvas.freeDrawingBrush.color = color;
      canvas.freeDrawingBrush.width = strokeWidth;
    }, [color, strokeWidth]);

    return (
      <canvas
        ref={canvasElRef}
        style={{ display: "block", cursor: tool === "select" ? "default" : "crosshair" }}
      />
    );
  }
);
