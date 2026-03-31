"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";

// ── Event types broadcast on the global /api/sync channel ─────────────────────

/** Payload sent/received (without the sender field used internally). */
export type GlobalSyncPayload =
  | { type: "navigate"; assignmentId: number }
  | { type: "playback"; assignmentId: number; studentId: number; frame: number; playing: boolean }
  | { type: "annotation-saved"; assignmentId: number; studentId: number }
  | { type: "playback-master"; assignmentId: number };

/** Full event including the sender id (present on received events). */
export type GlobalSyncEvent = GlobalSyncPayload & { sender: string };

interface GlobalSyncContextValue {
  paused: boolean;
  setPaused: (v: boolean | ((prev: boolean) => boolean)) => void;
  /** Broadcast an event to all other connected devices. No-op when paused. */
  broadcast: (event: GlobalSyncPayload) => void;
  /** Subscribe to incoming events from other devices. Returns an unsubscribe fn. */
  subscribe: (handler: (event: GlobalSyncEvent) => void) => () => void;
}

const GlobalSyncContext = createContext<GlobalSyncContextValue | null>(null);

// ── Provider ───────────────────────────────────────────────────────────────────

export function GlobalSyncProvider({ children }: { children: React.ReactNode }) {
  const clientId = useRef(Math.random().toString(36).slice(2)).current;
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Set of active event handlers — stable across renders
  const handlers = useRef(new Set<(event: GlobalSyncEvent) => void>());

  // ── SSE connection ─────────────────────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource("/api/sync");
    es.onmessage = (e) => {
      if (pausedRef.current) return;
      try {
        const event = JSON.parse(e.data) as GlobalSyncEvent;
        if (event.sender === clientId) return; // echo prevention
        handlers.current.forEach((h) => h(event));
      } catch {
        // malformed event — ignore
      }
    };
    return () => es.close();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally mount-once; pausedRef keeps paused state fresh

  const broadcast = useCallback(
    (event: GlobalSyncPayload) => {
      if (pausedRef.current) return;
      fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...event, sender: clientId }),
      }).catch(() => {});
    },
    [clientId],
  );

  const subscribe = useCallback((handler: (event: GlobalSyncEvent) => void) => {
    handlers.current.add(handler);
    return () => { handlers.current.delete(handler); };
  }, []);

  const value = useMemo(
    () => ({ paused, setPaused, broadcast, subscribe }),
    [paused, broadcast, subscribe],
  );

  return (
    <GlobalSyncContext.Provider value={value}>
      <NavigationSyncer broadcast={broadcast} subscribe={subscribe} />
      {children}
    </GlobalSyncContext.Provider>
  );
}

export function useGlobalSync() {
  const ctx = useContext(GlobalSyncContext);
  if (!ctx) throw new Error("useGlobalSync must be used inside GlobalSyncProvider");
  return ctx;
}

// ── Navigation sync — rendered inside provider so it can use the context ──────
//
// When the local user navigates to a different assignment, broadcast the change.
// When a remote device broadcasts, navigate to that assignment (staying on the
// same page type: grade-sheet vs review).

function NavigationSyncer({
  broadcast,
  subscribe,
}: Pick<GlobalSyncContextValue, "broadcast" | "subscribe">) {
  const pathname = usePathname();
  const router = useRouter();

  // Keep pathname fresh inside stable callbacks
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  // Track last broadcast/received assignment so we don't re-broadcast on arrival
  const lastHandledAssignmentId = useRef<number | null>(null);
  const remoteNavigateRef = useRef(false);

  // Extract assignment ID from the current pathname
  const assignmentId = useMemo(() => {
    const m = pathname.match(/^\/assignments\/(\d+)/);
    return m ? Number(m[1]) : null;
  }, [pathname]);

  // Broadcast whenever the local user navigates to a new assignment
  useEffect(() => {
    if (assignmentId === null) return;
    if (assignmentId === lastHandledAssignmentId.current) return;
    lastHandledAssignmentId.current = assignmentId;
    if (remoteNavigateRef.current) {
      remoteNavigateRef.current = false;
      return; // this navigation was triggered by a remote event — don't re-broadcast
    }
    broadcast({ type: "navigate", assignmentId });
  }, [assignmentId, broadcast]);

  // Subscribe to remote navigation events
  useEffect(() => {
    return subscribe((event) => {
      if (event.type !== "navigate") return;
      const targetId = event.assignmentId;
      const currentPathname = pathnameRef.current;
      if (currentPathname.startsWith(`/assignments/${targetId}`)) return; // already there

      const isReview = currentPathname.includes("/review");
      const target = isReview
        ? `/assignments/${targetId}/review`
        : `/assignments/${targetId}`;

      remoteNavigateRef.current = true;
      lastHandledAssignmentId.current = targetId;
      router.push(target);
    });
  }, [subscribe, router]);

  return null;
}
