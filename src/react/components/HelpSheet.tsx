"use client";

import { KEYMAP } from "../keymap";
import { C, label } from "../styles";

export function HelpSheet({ onClose }: { onClose: () => void }) {
  const groups = ["Transport", "View", "Annotation", "Session"] as const;

  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 40,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.container,
          borderRadius: 12,
          padding: 24,
          maxWidth: 760,
          width: "100%",
          maxHeight: "80%",
          overflowY: "auto",
          boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 18, color: C.text, fontWeight: 600 }}>
            Keyboard shortcuts
          </h2>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 18 }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {groups.map((g) => (
            <div key={g}>
              <div style={{ ...label, marginBottom: 8, color: C.primary }}>{g}</div>
              {KEYMAP.filter((k) => k.group === g).map((k) => (
                <div
                  key={k.keys + k.label}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "3px 0",
                    fontSize: 12,
                    color: C.muted,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "ui-monospace, SFMono-Regular, monospace",
                      color: C.text,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {k.keys}
                  </span>
                  <span style={{ textAlign: "right" }}>{k.label}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div style={{ marginTop: 20, fontSize: 11, color: C.faint, lineHeight: 1.6 }}>
          Two-finger drag pans and pinch zooms on a trackpad or iPad. Apple Pencil
          pressure varies pen width. Annotations are stored in media coordinates,
          so a note drawn on one device lands in the same place on every other.
        </div>
      </div>
    </div>
  );
}
