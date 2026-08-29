"use client";

import { useEffect, useRef } from "react";

/**
 * Syncs the selected student across browser sessions for the same assignment.
 *
 * - Connects to `/api/sync/[assignmentId]` via Server-Sent Events.
 * - When another session changes the student, calls `selectStudent` locally.
 * - When the local session changes the student, POSTs the new id so other
 *   sessions receive it.
 *
 * Echo prevention: each client tags its broadcasts with a random `sender` id
 * and ignores messages that arrive with its own id. A `remoteChangeRef` flag
 * also suppresses the re-broadcast that would otherwise happen when a remote
 * change triggers a local state update.
 *
 * `paused` is the same flag the WifiOff toggle in GradingShell puts on the
 * global nav/playback bus (see GlobalSyncProvider) — passed in here too so
 * that toggle actually stops *all* cross-device sync, not just navigation.
 * Mirrors GlobalSyncProvider's own paused handling: drop incoming events and
 * skip outgoing POSTs, don't queue anything to replay on resume.
 */
export function useSync(
  assignmentId: number,
  selectedStudentId: number | null,
  selectStudent: (id: number) => void,
  paused: boolean,
) {
  const clientId = useRef(Math.random().toString(36).slice(2));
  const prevStudentId = useRef(selectedStudentId);
  // Set to true when selectStudent is called due to a remote event, so the
  // subsequent state-change effect does not echo it back.
  const remoteChangeRef = useRef(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // ── Subscribe to the SSE stream ─────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource(`/api/sync/${assignmentId}`);

    es.onmessage = (event) => {
      if (pausedRef.current) return;
      try {
        const { studentId, sender } = JSON.parse(event.data) as {
          studentId: number;
          sender: string;
        };
        if (sender === clientId.current) return; // own echo
        if (studentId === prevStudentId.current) return; // already selected
        remoteChangeRef.current = true;
        selectStudent(studentId);
      } catch {
        // Ignore malformed messages.
      }
    };

    return () => es.close();
  // selectStudent is stable (useCallback in context), assignmentId never changes
  // for a given shell mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

  // ── Broadcast local selection changes ───────────────────────────────────
  useEffect(() => {
    if (selectedStudentId === prevStudentId.current) return;
    prevStudentId.current = selectedStudentId;

    if (selectedStudentId === null) return;

    // If this change came from a remote event, skip the broadcast.
    if (remoteChangeRef.current) {
      remoteChangeRef.current = false;
      return;
    }

    if (pausedRef.current) return;

    fetch(`/api/sync/${assignmentId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId: selectedStudentId, sender: clientId.current }),
    }).catch(() => {}); // fire-and-forget
  }, [assignmentId, selectedStudentId]);
}
