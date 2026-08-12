"use client";

import type { LayerManifest } from "../../core/types";
import { C, label, textButton } from "../styles";

interface LayerPanelProps {
  manifest: LayerManifest | null;
  visible: Record<string, boolean>;
  solo: string | null;
  composite: boolean;
  onToggle: (id: string, value: boolean) => void;
  onSolo: (id: string | null) => void;
  onComposite: (v: boolean) => void;
}

/**
 * PSD layer tree.
 *
 * Deliberately explicit about what it cannot do: adjustment layers are baked
 * into the composite and non-separable blend modes are approximated. Marking
 * them beats silently rendering something that is not what Photoshop shows.
 */
export function LayerPanel({
  manifest,
  visible,
  solo,
  composite,
  onToggle,
  onSolo,
  onComposite,
}: LayerPanelProps) {
  if (!manifest) return null;

  return (
    <div
      style={{
        width: 240,
        background: C.low,
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      <div style={{ padding: "10px 12px", display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ ...label, flex: 1 }}>Layers</span>
        <button onClick={() => onComposite(true)} style={textButton(composite)}>
          Composite
        </button>
        <button onClick={() => onComposite(false)} style={textButton(!composite)}>
          Stack
        </button>
      </div>

      {manifest.compositeOnly && (
        <div style={{ padding: "0 12px 8px", fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
          Too many layers to render individually — the tree is browsable but the
          composite is what you see.
        </div>
      )}

      <div style={{ overflowY: "auto", flex: 1, padding: "0 6px 8px" }}>
        {manifest.layers.map((l) => {
          const isVisible = visible[l.id] ?? l.visible;
          const dimmed = solo !== null && solo !== l.id;
          return (
            <div
              key={l.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 6px",
                paddingLeft: 6 + l.depth * 12,
                borderRadius: 5,
                opacity: dimmed ? 0.35 : 1,
                background: solo === l.id ? "rgba(255,144,105,0.12)" : "transparent",
              }}
            >
              <input
                type="checkbox"
                checked={isVisible}
                disabled={composite || manifest.compositeOnly}
                onChange={(e) => onToggle(l.id, e.target.checked)}
                style={{ accentColor: C.primary, cursor: "pointer" }}
              />
              <span
                style={{
                  flex: 1,
                  fontSize: 12,
                  color: l.isGroup ? C.muted : C.text,
                  fontWeight: l.isGroup ? 600 : 400,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={`${l.name} · ${l.blendMode} · ${Math.round(l.opacity * 100)}%`}
              >
                {l.isGroup ? "▸ " : ""}
                {l.name || "(unnamed)"}
              </span>

              {l.blendUnsupported && (
                <span
                  title={`${l.blendMode} is not reproducible in the shader — shown as normal`}
                  style={{ fontSize: 10, color: C.primary }}
                >
                  ≉
                </span>
              )}
              {l.bakedIntoComposite && (
                <span
                  title="Adjustment layer or smart filter — baked into the composite, cannot be toggled"
                  style={{ fontSize: 10, color: C.faint }}
                >
                  fx
                </span>
              )}
              {!l.isGroup && !manifest.compositeOnly && (
                <button
                  onClick={() => onSolo(solo === l.id ? null : l.id)}
                  title="Solo this layer"
                  style={{
                    border: "none",
                    background: "transparent",
                    color: solo === l.id ? C.primary : C.faint,
                    cursor: "pointer",
                    fontSize: 10,
                    padding: "0 2px",
                  }}
                >
                  S
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
