import type {
  ColorState,
  FitMode,
  LoopMode,
  Role,
  Rotation,
  StrokeTool,
  ViewerState,
} from "./types";

/**
 * The closed action set.
 *
 * Remote control is "broadcast the actions I dispatch, apply the actions I
 * receive" — there is no second code path for sync, so a remote click and a
 * local click cannot drift apart.
 */

/** A stroke as it travels on the wire: metadata + base64 of the binary body. */
export interface WireStroke {
  id?: number;
  seq?: number;
  localId: string;
  itemId: string;
  frameIn: number;
  frameOut: number;
  authorId: string;
  /** base64 of encodeStroke() output. */
  b: string;
}

export type Action =
  // ── transport ───────────────────────────────────────────────────────────────
  | { a: "goto"; item: number; frame: number }
  | { a: "seek"; frame: number }
  | { a: "play" }
  | { a: "pause" }
  | { a: "transport"; playing: boolean; frame: number; rate: number; at: number }
  | { a: "rate"; rate: number }
  | { a: "loop"; mode: LoopMode }
  | { a: "fps"; fps: number }
  // ── view ────────────────────────────────────────────────────────────────────
  | { a: "flip"; h?: boolean; v?: boolean }
  | { a: "rotate"; deg: Rotation }
  | { a: "view"; zoom?: number; panX?: number; panY?: number; fit?: FitMode }
  | { a: "color"; patch: Partial<ColorState> }
  | {
      a: "layers";
      visible?: Record<string, boolean>;
      solo?: string | null;
      composite?: boolean;
    }
  | {
      a: "opts";
      patch: Partial<Pick<ViewerState, "pauseOnAnnotated" | "ghostMs" | "onionSkin">>;
    }
  // ── annotation ──────────────────────────────────────────────────────────────
  | { a: "stroke"; s: WireStroke }
  | {
      a: "ink";
      id: string;
      author: string;
      tool: StrokeTool;
      color: number;
      width: number;
      /** Normalised [x,y,…] appended since the last ink message. */
      pts: number[];
      done?: boolean;
    }
  /**
   * Both keys travel. `ids` are server ids, which a peer may not have yet — it
   * sees a stroke the moment it is drawn, a beat before the database assigns
   * one. `localIds` are minted client-side and are on every copy from birth.
   */
  | { a: "erase"; ids: number[]; localIds: string[]; itemId: string }
  // ── ephemeral ───────────────────────────────────────────────────────────────
  | { a: "laser"; x: number; y: number; client: string }
  // ── session ─────────────────────────────────────────────────────────────────
  | { a: "claim"; client: string; name: string }
  | { a: "release"; client: string }
  /**
   * `reply` marks an announcement sent in answer to someone else's hello.
   * Without it, every hello triggers a hello back, which triggers another —
   * two peers then flood the channel at network speed (measured: 91 msg/s from
   * two idle tabs) and real transport events queue up behind the noise.
   */
  | { a: "hello"; client: string; name: string; role: Role; reply?: boolean }
  | { a: "bye"; client: string }
  | { a: "ping"; client: string; t: number }
  | { a: "pong"; client: string; t: number; to: string; remote: number };

export type ActionKind = Action["a"];

/** Envelope as it appears on the channel. */
export type Envelope = Action & { sender: string; ctx: string };

/**
 * Actions a master broadcasts. View actions are deliberately excluded — they
 * ride only when the follower has opted into "follow view", because the
 * projector should mirror zoom while an iPad in someone's lap probably should
 * not. Tool and colour selection never travel at all.
 */
export const TRANSPORT_ACTIONS: ReadonlySet<ActionKind> = new Set<ActionKind>([
  "goto",
  "seek",
  "play",
  "pause",
  "transport",
  "rate",
  "loop",
  "fps",
]);

export const VIEW_ACTIONS: ReadonlySet<ActionKind> = new Set<ActionKind>([
  "flip",
  "rotate",
  "view",
  "color",
  "layers",
]);

/** Annotation and presence traffic reaches every peer regardless of role. */
export const ALWAYS_ACTIONS: ReadonlySet<ActionKind> = new Set<ActionKind>([
  "stroke",
  "ink",
  "erase",
  "laser",
  "claim",
  "release",
  "hello",
  "bye",
  "ping",
  "pong",
]);

export function isBroadcast(kind: ActionKind, opts: { isMaster: boolean; followView: boolean }): boolean {
  if (ALWAYS_ACTIONS.has(kind)) return true;
  if (!opts.isMaster) return false;
  if (TRANSPORT_ACTIONS.has(kind)) return true;
  return opts.followView && VIEW_ACTIONS.has(kind);
}

/** Should an incoming action be applied, given this peer's role? */
export function shouldApply(
  kind: ActionKind,
  opts: { role: Role; followView: boolean },
): boolean {
  if (ALWAYS_ACTIONS.has(kind)) return true;
  if (opts.role !== "follower") return false;
  if (TRANSPORT_ACTIONS.has(kind)) return true;
  return opts.followView && VIEW_ACTIONS.has(kind);
}
