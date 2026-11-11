"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { C, textButton } from "../styles";

interface MoreMenuProps {
  /** Tooltip naming what is inside. */
  title: string;
  /** "below" for a header, "above" for the bars under the stage. */
  placement: "below" | "above";
  /** Which edge of the button the panel lines up with. */
  align?: "start" | "end";
  children: ReactNode;
}

/**
 * "⋯": where controls go when their row has no room for them.
 *
 * The panel is position: fixed, measured from the button when it opens, so
 * that the rows it hangs off can clip their own overflow (the alternative to
 * clipping is a scrollbar, or wrapping onto a second row) without clipping
 * the panel. It closes on a resize rather than following the button, because
 * a resize can move the button into a different tier altogether.
 */
export function MoreMenu({ title, placement, align = "end", children }: MoreMenuProps) {
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const open = pos !== null;

  const toggle = () => {
    if (open || !buttonRef.current) {
      setPos(null);
      return;
    }
    const r = buttonRef.current.getBoundingClientRect();
    const vertical =
      placement === "below" ? { top: r.bottom + 6 } : { bottom: window.innerHeight - r.top + 6 };
    const horizontal =
      align === "end"
        ? { right: Math.max(8, window.innerWidth - r.right) }
        : { left: Math.max(8, r.left) };
    setPos({ ...vertical, ...horizontal });
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        onClick={toggle}
        style={{ ...textButton(open), flexShrink: 0, padding: "0 9px" }}
        title={title}
        aria-expanded={open}
      >
        ⋯
      </button>
      {open && (
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            ...pos,
            zIndex: 60,
            background: C.container,
            border: `1px solid ${C.ghost}`,
            borderRadius: 8,
            padding: 10,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 10,
            boxShadow: "0 12px 28px rgba(0,0,0,0.5)",
          }}
        >
          {children}
        </div>
      )}
    </>
  );
}

/** One line of a MoreMenu panel. Rows never wrap: a group is read as a unit. */
export function MenuRow({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>{children}</div>
  );
}
