"use client";

import { useMemo, useRef } from "react";
import type { Action, Envelope, ReviewChannel } from "@grader/art-review";
import { useGlobalSync, type GlobalSyncPayload } from "@/components/shared/global-sync";

/**
 * ReviewChannel on top of grader's existing global sync bus.
 *
 * It deliberately does NOT open its own EventSource. Grader already holds two
 * SSE streams per tab (/api/sync and /api/sync/[assignmentId]); a third put
 * every tab at three, and browsers cap concurrent HTTP/1.1 connections per
 * origin at ~6 — which both `next dev` and `next start` serve. Two tabs on one
 * machine then consumed all six and every other request, including the server
 * action that loads the media, stalled forever with no error.
 *
 * Riding the existing bus keeps a tab at two streams and leaves headroom.
 *
 * Trade-off: /api/sync fans out to every connected tab regardless of
 * assignment, so review traffic reaches tabs that do not care and is discarded
 * client-side by `ctx`. On a studio LAN that is cheap. If live-ink volume ever
 * becomes a problem, the fix is a WebSocket — not a third SSE stream.
 */

/** Marks an envelope as ours so other consumers of the bus ignore it. */
const REVIEW_KIND = "art-review";

type ReviewEnvelope = Envelope & { kind: typeof REVIEW_KIND };

export function useReviewChannel(contextId: string | null): ReviewChannel | null {
  const { broadcast, subscribe } = useGlobalSync();
  const clientId = useRef(Math.random().toString(36).slice(2, 10)).current;

  return useMemo(() => {
    if (!contextId) return null;

    return {
      clientId,
      // The provider owns the socket and reconnects on its own; it exposes no
      // connection state, so presence shows "connected" optimistically.
      connected: true,

      send(action: Action) {
        broadcast({
          ...action,
          kind: REVIEW_KIND,
          ctx: contextId,
        } as unknown as GlobalSyncPayload);
      },

      subscribe(handler: (e: Envelope) => void) {
        return subscribe((event) => {
          const envelope = event as unknown as ReviewEnvelope;
          // Own-echo is already filtered by the provider; filter foreign kinds
          // and other students' reviews here.
          if (envelope.kind !== REVIEW_KIND) return;
          if (envelope.ctx !== contextId) return;
          handler(envelope);
        });
      },

      onConnectionChange(handler: (connected: boolean) => void) {
        handler(true);
        return () => {};
      },
    };
  }, [contextId, clientId, broadcast, subscribe]);
}
