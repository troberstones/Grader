"use client";

import { useEffect, useState } from "react";
import { QUALITY_STEPS, type VideoQuality } from "../../core/budget";
import { RGBE_TRANSFER } from "../../core/rgbe";
import type { ReviewItem } from "../../core/types";
import { DecodedVideoSource } from "../../sources/decoded-video";
import { setStoredCacheLimit, sharedLedger, storedCacheLimit } from "../../sources/ledger";
import type { FrameSource } from "../../sources/types";
import { VideoElementSource } from "../../sources/video-element";
import { C, label, noSelect, select as selectStyle, textButton } from "../styles";
import { useElementWidth } from "../useElementWidth";
import type { SessionApi } from "../useSession";
import { MenuRow, MoreMenu } from "./MoreMenu";
import { Presence } from "./Presence";

/**
 * How much of the cluster shows in its row. Measured on the row itself, so
 * the same thresholds work wherever the host puts it.
 *
 *   full     everything, labelled
 *   compact  session and audio stay; peers, memory and video quality go
 *            behind "⋯"
 *   minimal  the session badge alone, everything else behind "⋯"
 *
 * One threshold per tier regardless of what is open: a cluster that changed
 * tier when you stepped from a still to a video would be exactly the jump
 * this exists to avoid.
 */
type GlobalTier = "full" | "compact" | "minimal";
// Measured, with a video open and two peers connected: full needs ~1070px,
// compact ~580px.
const FULL_MIN = 1100;
const COMPACT_MIN = 600;

export interface GlobalControlsProps {
  /** Omitted for a read-only viewer, which has no room to coordinate with. */
  session?: SessionApi;
  audioOwner: boolean;
  onAudioOwner: (on: boolean) => void;
  item: ReviewItem | null;
  autoCacheBytes: number;
  video: {
    source: FrameSource | null;
    quality: VideoQuality;
    onQuality: (q: VideoQuality) => void;
    sharpen: boolean;
    onSharpen: (on: boolean) => void;
  };
  /** Omitted when the input log is not offered. */
  log?: { open: boolean; onToggle: () => void };
  onHelp: () => void;
}

/**
 * The reviewer's controls that are about this machine and the room rather
 * than about the piece on screen: who is driving, which screen plays audio,
 * how much memory the frame cache may take, how sharp video is cached, and
 * the input log and help.
 *
 * Fills whatever row it is put in (a host can portal it into its own chrome)
 * and lines up against that row's right edge. It never wraps and never
 * scrolls; it steps down a tier instead.
 */
export function GlobalControls({
  session,
  audioOwner,
  onAudioOwner,
  item,
  autoCacheBytes,
  video,
  log,
  onHelp,
}: GlobalControlsProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const tier: GlobalTier =
    width === null || width >= FULL_MIN ? "full" : width >= COMPACT_MIN ? "compact" : "minimal";

  const audio = (
    <label
      style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", flexShrink: 0 }}
      title="Only one machine in the room should play audio"
    >
      <input
        type="checkbox"
        checked={audioOwner}
        onChange={(e) => onAudioOwner(e.target.checked)}
        style={{ accentColor: C.primary }}
      />
      <span style={label}>Audio</span>
    </label>
  );
  const hasStats = !!session && (session.peers.length > 0 || session.rttMs !== null);
  const memory = <MemoryReadout autoBytes={autoCacheBytes} item={item} />;
  const quality =
    item?.kind === "video" ? (
      <VideoQualityControl
        item={item}
        source={video.source}
        quality={video.quality}
        onQuality={video.onQuality}
        sharpen={video.sharpen}
        onSharpen={video.onSharpen}
      />
    ) : null;

  return (
    <div
      ref={ref}
      style={{
        ...noSelect,
        width: "100%",
        minWidth: 0,
        // Clips rather than scrolls if a tier's estimate is ever short; the
        // menus are position: fixed, so they are not clipped with it.
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 12,
        color: C.text,
        fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Manrope', 'Segoe UI', sans-serif",
      }}
    >
      {session && <Presence session={session} part={tier === "full" ? "all" : "status"} />}
      {session && tier === "compact" && <Presence session={session} part="controls" />}
      {tier !== "minimal" && audio}
      {tier === "full" && memory}
      {tier === "full" && quality}
      {tier !== "full" && (
        <MoreMenu
          title={tier === "minimal" ? "Session, audio, memory, video quality" : "Peers, memory, video quality"}
          placement="below"
        >
          {tier === "minimal" && session && (
            <MenuRow>
              <Presence session={session} part="controls" />
            </MenuRow>
          )}
          {session && hasStats && (
            <MenuRow>
              <Presence session={session} part="stats" />
            </MenuRow>
          )}
          {tier === "minimal" && <MenuRow>{audio}</MenuRow>}
          <MenuRow>
            <span style={label}>Cache</span>
            {memory}
          </MenuRow>
          {quality && (
            <MenuRow>
              <span style={label}>Video</span>
              {quality}
            </MenuRow>
          )}
        </MoreMenu>
      )}
      {log && (
        // The keyboard shortcut is no use on the device this is for.
        <button
          onClick={log.onToggle}
          style={{ ...textButton(log.open), flexShrink: 0 }}
          title="Input log — every pointer event and what it did  D"
        >
          ⌁
        </button>
      )}
      <button onClick={onHelp} style={{ ...textButton(), flexShrink: 0 }} title="Shortcuts  ?">
        ?
      </button>
    </div>
  );
}

/**
 * Frame-cache memory, live. Worth a permanent slot rather than a debug flag:
 * this is the number that decides whether the tab is comfortable or pushing
 * the machine into swap, and it should never be a mystery.
 */
const MB = 1024 * 1024;

/**
 * Cache ceilings offered by hand. Stops at 2 GB because the ledger clamps
 * there anyway: the constraint is Chrome's renderer heap, not the machine's
 * memory, and a tab that asks for more gets killed rather than throttled.
 */
const CACHE_CHOICES = [512 * MB, 1024 * MB, 1536 * MB, 2048 * MB];

function MemoryReadout({ autoBytes, item }: { autoBytes: number; item: ReviewItem | null }) {
  const ledger = sharedLedger();
  const [, force] = useState(0);

  useEffect(() => {
    const off = ledger.onChange(() => force((n) => n + 1));
    const timer = setInterval(() => force((n) => n + 1), 2000);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [ledger]);

  const usedMb = ledger.bytesUsed / 1024 / 1024;
  const limitMb = ledger.bytesLimit / 1024 / 1024;
  const pressure = ledger.pressure;

  // What the current item costs to hold whole — the number that decides whether
  // playback is smooth or decodes a frame at a time. HDR frames are held twice
  // over, packed and unpacked, which is where the factor of three comes from.
  const perFrame = item
    ? item.width * item.height * (item.colorSpace?.transfer === RGBE_TRANSFER ? 12 : 4)
    : 0;
  const wholeItemMb = (perFrame * (item?.frameCount ?? 1)) / 1024 / 1024;
  const fits = wholeItemMb > 0 && wholeItemMb <= limitMb;

  const hint = item
    ? ` ${item.label} needs ${wholeItemMb.toFixed(0)} MB to hold every frame — ${
        fits ? "it fits, so playback runs from memory." : "it does not fit, so playback re-decodes."
      }`
    : "";

  return (
    <span style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
      <span
        title={`Decoded frame cache across every open file.${hint}`}
        style={{
          ...label,
          color: pressure > 0.9 ? C.primary : C.faint,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {usedMb.toFixed(0)}/{limitMb.toFixed(0)} MB
      </span>
      <select
        value={storedCacheLimit() ?? ""}
        onChange={(e) => {
          setStoredCacheLimit(e.target.value ? Number(e.target.value) : null, autoBytes);
          force((n) => n + 1);
        }}
        title={
          "Frame cache ceiling. Detection guesses from the browser, which cannot know a whole " +
          "shot is worth holding resident — raise it when a sequence will not fit." +
          hint
        }
        style={{ ...selectStyle, padding: "1px 4px", fontSize: 10 }}
      >
        <option value="">Auto ({(autoBytes / MB).toFixed(0)})</option>
        {CACHE_CHOICES.map((b) => (
          <option key={b} value={b}>
            {b >= 1024 * MB ? `${(b / 1024 / MB).toFixed(b % (1024 * MB) ? 1 : 0)} GB` : `${b / MB} MB`}
          </option>
        ))}
      </select>
    </span>
  );
}

/** "1080p" for a 1920×1080 frame; measured on the short side, as YouTube does. */
function linesLabel(width: number, height: number): string {
  return `${Math.min(width, height)}p`;
}

/**
 * Cache resolution for the open video, YouTube-style: Auto, the clip's own
 * resolution, then the standard steps below it. Auto names what it actually
 * chose, because "Auto" alone is how a 1080p render ended up on screen at
 * 180p without anyone knowing why.
 */
function VideoQualityControl({
  item,
  source,
  quality,
  onQuality,
  sharpen,
  onSharpen,
}: {
  item: ReviewItem;
  source: FrameSource | null;
  quality: VideoQuality;
  onQuality: (q: VideoQuality) => void;
  sharpen: boolean;
  onSharpen: (on: boolean) => void;
}) {
  const native = Math.min(item.width, item.height);
  const steps = QUALITY_STEPS.filter((h) => h < native);
  const cached = source instanceof DecodedVideoSource ? source : null;
  const streaming = source instanceof VideoElementSource;

  // A remembered step at or above this clip's own size means native here.
  const value = quality === "auto" ? "auto" : quality === "full" || quality >= native ? "full" : String(quality);
  const autoLabel = cached ? `Auto (${linesLabel(cached.cacheWidth, cached.cacheHeight)})` : "Auto";

  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
      <select
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          onQuality(v === "auto" || v === "full" ? v : Number(v));
        }}
        title={
          cached
            ? `Cached at ${cached.cacheWidth}×${cached.cacheHeight} of ${item.width}×${item.height}.`
            : streaming
              ? `Streaming at ${item.width}×${item.height}.`
              : "Video resolution"
        }
        style={{ ...selectStyle, padding: "1px 4px", fontSize: 10 }}
      >
        <option value="auto">{autoLabel}</option>
        <option value="full">Full ({linesLabel(item.width, item.height)})</option>
        {steps.map((h) => (
          <option key={h} value={h}>
            {h}p
          </option>
        ))}
      </select>
      <label
        style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}
        title="When paused, redraw the frame at the clip's full resolution even if the cache holds it smaller"
      >
        <input
          type="checkbox"
          checked={sharpen}
          onChange={(e) => onSharpen(e.target.checked)}
          style={{ accentColor: C.primary }}
        />
        <span style={label}>Sharpen on pause</span>
      </label>
    </span>
  );
}

