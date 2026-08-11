import type { CSSProperties } from "react";

/**
 * Inline style objects rather than Tailwind classes.
 *
 * The module has to render correctly inside any host without that host having
 * to configure a CSS pipeline for it. Colours follow grader's Editorial Gallery
 * palette so it does not look foreign when embedded.
 */

export const C = {
  bg: "#0e0e0e",
  low: "#131313",
  container: "#1a1919",
  high: "#262626",
  lowest: "#000000",
  text: "#f2f0ef",
  muted: "#adaaaa",
  faint: "#6f6c6b",
  primary: "#ff9069",
  primaryDeep: "#ff7948",
  ghost: "rgba(73, 72, 71, 0.4)",
  danger: "#ef4444",
  good: "#22c55e",
} as const;

export const INK_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#38bdf8",
  "#a855f7",
  "#ffffff",
  "#0a0a0a",
];

export const INK_WIDTHS = [2, 4, 8, 16];

export const panel: CSSProperties = {
  background: C.container,
  borderRadius: 8,
  padding: 8,
  display: "flex",
  alignItems: "center",
  gap: 6,
};

export const iconButton = (active = false, disabled = false): CSSProperties => ({
  width: 32,
  height: 32,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 6,
  border: "none",
  background: active ? C.primary : "transparent",
  color: active ? "#000" : disabled ? C.faint : C.text,
  cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.45 : 1,
  fontSize: 13,
  lineHeight: 1,
  padding: 0,
  transition: "background 120ms ease, color 120ms ease",
});

export const textButton = (active = false): CSSProperties => ({
  height: 30,
  padding: "0 10px",
  borderRadius: 6,
  border: "none",
  background: active ? C.primary : C.high,
  color: active ? "#000" : C.text,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 500,
  whiteSpace: "nowrap",
});

export const label: CSSProperties = {
  fontSize: 11,
  color: C.muted,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

export const select: CSSProperties = {
  height: 28,
  background: C.lowest,
  color: C.text,
  border: `1px solid ${C.ghost}`,
  borderRadius: 6,
  fontSize: 12,
  padding: "0 6px",
};

export const numberInput: CSSProperties = {
  ...select,
  width: 56,
};

export const badge = (bg: string, fg = "#000"): CSSProperties => ({
  background: bg,
  color: fg,
  borderRadius: 999,
  padding: "2px 9px",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.02em",
  whiteSpace: "nowrap",
});
