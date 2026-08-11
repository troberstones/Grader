import type {
  ColorState,
  FitMode,
  GuideKind,
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

/** Everything a follower needs to match the master, independent of history. */
export interface SyncSnapshot {
  itemIndex: number;
  flipH: boolean;
  flipV: boolean;
  rotate: Rotation;
  color: ColorState;
  guides: GuideKind;
  layers: Record<string, boolean>;
  soloLayer: string | null;
  composite: boolean;
  /** Applied only by a follower with "follow view" on. */
  zoom: number;
  panX: number;
  panY: number;
  fit: FitMode;
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
  | { a: "guides"; mode: GuideKind }
  /**
   * The master's whole visible state, sent on a heartbeat and to anyone who
   * says hello. Every other action is a delta, so a single dropped message
   * leaves a follower wrong until that same field changes again — which for a
   * flip or a channel might be never. This is the floor under all of them.
   */
  | { a: "sync"; s: SyncSnapshot }
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

/**
 * Envelope as it appears on the channel.
 *
 * `sender`, `ctx` and `kind` are reserved: the transport spreads the action and
 * then stamps these on top, so an action field sharing one of those names is
 * silently overwritten in flight. That is how the guides action first shipped —
 * its payload was `kind`, and every follower received the string "art-review"
 * where a guide name should have been.
 */
export type Envelope = Action & { sender: string; ctx: string };

/**
 * Actions a master broadcasts.
 *
 * The line that matters is *what the image looks like* against *where you are
 * looking at it*. Flip, rotate, desaturate, isolate a channel, put thirds over
 * it, hide a PSD layer — those change the thing under discussion, and a room
 * that disagrees about them is a room talking past itself. They follow the
 * master exactly like transport does.
 *
 * Zoom and pan are the other kind. The projector should mirror them; an iPad in
 * someone's lap probably should not, which is what "follow view" is for.
 *
 * Tool and colour selection never travel at all — that is your pen, not the
 * room's.
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

/** Appearance of the image itself. Follows the master unconditionally. */
export const PRESENTATION_ACTIONS: ReadonlySet<ActionKind> = new Set<ActionKind>([
  "flip",
  "rotate",
  "color",
  "guides",
  "layers",
  "sync",
]);

/** Framing only — zoom, pan, fit. Gated on "follow view". */
export const VIEW_ACTIONS: ReadonlySet<ActionKind> = new Set<ActionKind>(["view"]);

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

/**
 * A master broadcasts everything it does. It does *not* consult its own
 * "follow view" — that setting is the receiver's answer to "do I mirror the
 * master's framing", and a master follows nobody.
 *
 * Reading it here meant zoom crossed only when both machines happened to have
 * the box ticked, so ticking it on the follower — the only place it reads as
 * meaningful — did nothing at all.
 */
export function isBroadcast(kind: ActionKind, opts: { isMaster: boolean }): boolean {
  if (ALWAYS_ACTIONS.has(kind)) return true;
  if (!opts.isMaster) return false;
  return (
    TRANSPORT_ACTIONS.has(kind) || PRESENTATION_ACTIONS.has(kind) || VIEW_ACTIONS.has(kind)
  );
}

/** Should an incoming action be applied, given this peer's role? */
export function shouldApply(
  kind: ActionKind,
  opts: { role: Role; followView: boolean },
): boolean {
  if (ALWAYS_ACTIONS.has(kind)) return true;
  if (opts.role !== "follower") return false;
  if (TRANSPORT_ACTIONS.has(kind) || PRESENTATION_ACTIONS.has(kind)) return true;
  return opts.followView && VIEW_ACTIONS.has(kind);
}
