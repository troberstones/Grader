"use client";

import type { SessionApi } from "../useSession";
import { badge, C, label, textButton } from "../styles";

/**
 * Who is connected, who is driving, and how far away they are.
 *
 * Master governs transport only — a follower drawing on the projector is a
 * first-class author, so the controls here never gate annotation.
 */
export function Presence({ session }: { session: SessionApi }) {
  const { role, isMaster, peers, masterName, connected, rttMs } = session;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span
        title={connected ? "Connected to the review channel" : "Disconnected — reconnecting"}
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: connected ? C.good : C.danger,
          flexShrink: 0,
        }}
      />

      {isMaster ? (
        <span style={badge(C.primary)}>Master</span>
      ) : role === "free" ? (
        <span style={badge(C.high, C.text)}>Browsing alone</span>
      ) : (
        <span style={badge(C.high, C.muted)}>
          {masterName ? `Following ${masterName}` : "Following"}
        </span>
      )}

      {isMaster ? (
        <button onClick={session.release} style={textButton()} title="Give up control  M">
          Release
        </button>
      ) : (
        <button onClick={session.claim} style={textButton()} title="Take control  M">
          Take control
        </button>
      )}

      {role === "follower" && !isMaster && (
        <button onClick={session.breakAway} style={textButton()} title="Browse independently">
          Break away
        </button>
      )}
      {role === "free" && (
        <button onClick={session.rejoin} style={textButton()} title="Snap back to the master">
          Rejoin
        </button>
      )}

      <label
        style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}
        title="Also mirror the master's zoom and pan"
      >
        <input
          type="checkbox"
          checked={session.followView}
          onChange={(e) => session.setFollowView(e.target.checked)}
          style={{ accentColor: C.primary }}
        />
        <span style={label}>Follow view</span>
      </label>

      {peers.length > 0 && (
        <span style={{ ...label, color: C.faint }} title={peers.map((p) => p.name).join(", ")}>
          {peers.length} other{peers.length === 1 ? "" : "s"}
        </span>
      )}
      {rttMs !== null && (
        <span style={{ ...label, color: C.faint }} title="Round-trip latency">
          {rttMs} ms
        </span>
      )}
    </div>
  );
}
