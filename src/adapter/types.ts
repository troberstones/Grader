import type { Action, Envelope, WireStroke } from "../core/actions";
import type { FrameMarker, LayerManifest, ReviewItem, Stroke } from "../core/types";

/**
 * The entire surface between this module and its host application.
 *
 * Keeping it to exactly two interfaces — data and channel — is what makes the
 * LAN-only assumption reversible: going internet-reachable later touches these
 * implementations and nothing else in the module.
 */

export interface StrokeInput {
  localId: string;
  frameIn: number;
  frameOut: number;
  authorId: string;
  /** base64 of the binary stroke body. */
  b: string;
}

export interface StoredStroke extends StrokeInput {
  id: number;
  seq: number;
  createdAt: string;
}

export interface ReviewDataAdapter {
  /** The playlist for a context (in grader: one student's submissions). */
  listItems(contextId: string): Promise<ReviewItem[]>;

  /**
   * Strokes for an item. `sinceSeq` makes a reconnect incremental rather than a
   * full refetch — a device that dropped for ten seconds pulls only what it
   * missed. Soft-deleted strokes come back with a `deleted` marker so the
   * caller can drop them from an existing set.
   */
  getStrokes(
    itemId: string,
    sinceSeq?: number,
  ): Promise<{ strokes: StoredStroke[]; deleted: number[]; head: number }>;

  appendStrokes(itemId: string, strokes: StrokeInput[]): Promise<StoredStroke[]>;

  deleteStrokes(itemId: string, ids: number[]): Promise<void>;

  /** Timeline ticks without decoding a single stroke body. */
  getMarkers(itemId: string): Promise<FrameMarker[]>;

  /** PSD layer tree. Only called for items of kind `layered`. */
  getLayers(itemId: string): Promise<LayerManifest>;

  /** Persist per-user viewer preferences (fps, loop, flips) for a context. */
  savePrefs?(contextId: string, prefs: Record<string, unknown>): Promise<void>;
  loadPrefs?(contextId: string): Promise<Record<string, unknown> | null>;

  /**
   * Park a diagnostic dump somewhere the developer can read it, and say where.
   *
   * Optional, and the input log's Send button only appears when the host
   * provides it. This exists because the device with the bug is a tablet: the
   * clipboard is unavailable over http, and a downloaded file has to be found
   * in Files and transcribed by hand before anyone can look at it.
   */
  sendDiagnostics?(name: string, text: string): Promise<string>;
}

export interface ReviewChannel {
  /** Send an action to every other peer in the context. */
  send(action: Action): void;
  /** Subscribe to incoming actions. Returns an unsubscribe function. */
  subscribe(handler: (event: Envelope) => void): () => void;
  /** This peer's stable id for the life of the page. */
  readonly clientId: string;
  /** Connection state, for the presence UI. */
  readonly connected: boolean;
  onConnectionChange(handler: (connected: boolean) => void): () => void;
  /**
   * Tear down the underlying transport. Must be called when the context
   * changes — browsers cap concurrent connections per origin (~6 on HTTP/1.1,
   * which is what `next dev` and `next start` serve), so a leaked stream per
   * student switch will stall the whole page after a handful of them.
   */
  close?(): void;
}

/** Convenience type for the committed-stroke path. */
export type { Stroke, WireStroke, FrameMarker, LayerManifest, ReviewItem };
