"use client";

import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";

// Shape injected by ls-bridge-extension/inject.js
interface LsBridgeAPI {
  getStatus: () => Promise<{
    lsTabOpen: boolean;
    lsState: { subsessionID: string; courseID: string } | null;
    graderOrigin: string;
  }>;
  syncRoster: (courseId: number) => Promise<{ imported: number; updated: number }>;
  syncAssignments: (courseId: number, gradebookID?: string) => Promise<{
    added: number;
    updated: number;
    synced: { id: number; lmsAssignmentId: string; name: string }[];
    gradebookID: string;
  }>;
  syncSubmissions: (graderAssignmentId: number) => Promise<{
    synced: number;
    errors: { lmsStudentId: string; error: string }[];
  }>;
  pushGrades: (graderAssignmentId: number) => Promise<{
    pushed: number;
    errors: { lmsStudentId: string; error: string }[];
  }>;
}

declare global {
  interface Window {
    lsBridge?: LsBridgeAPI;
  }
}

type BridgeStatus = "checking" | "unavailable" | "no-ls-tab" | "ready";

export function useLsBridge() {
  const [status, setStatus] = useState<BridgeStatus>("checking");
  const [lsState, setLsState] = useState<{ subsessionID: string; courseID: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Check extension availability on mount
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (typeof window === "undefined") return;
      // Give inject.js a moment to set up window.lsBridge
      await new Promise((r) => setTimeout(r, 300));
      if (cancelled) return;

      if (!window.lsBridge) {
        setStatus("unavailable");
        return;
      }
      try {
        const s = await window.lsBridge.getStatus();
        if (cancelled) return;
        setLsState(s.lsState);
        setStatus(s.lsTabOpen ? "ready" : "no-ls-tab");
      } catch {
        if (!cancelled) setStatus("unavailable");
      }
    };
    check();
    return () => { cancelled = true; };
  }, []);

  const run = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | null> => {
      if (!window.lsBridge) {
        setLastError("LS Bridge extension is not installed.");
        return null;
      }
      setBusy(true);
      setLastError(null);
      try {
        return await fn();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setLastError(msg);
        toast.error("LS sync failed", { description: msg });
        return null;
      } finally {
        setBusy(false);
      }
    },
    []
  );

  return {
    /** Extension + LS tab status */
    status,
    lsState,
    busy,
    lastError,

    /** Sync class roster from LS into the grader course */
    syncRoster: (courseId: number) =>
      run(() => window.lsBridge!.syncRoster(courseId)),

    /**
     * Sync assignments from the LS gradebook into a grader course.
     * Requires the LS gradebook (Grades > Scores) to be open so the extension
     * can auto-detect the gradebookID. Pass a known gradebookID to skip detection.
     */
    syncAssignments: (courseId: number, gradebookID?: string) =>
      run(() => window.lsBridge!.syncAssignments(courseId, gradebookID)),

    /**
     * Download all student submission files for an assignment from LS.
     * Requires roster + assignment sync to have been run first.
     */
    syncSubmissions: (graderAssignmentId: number) =>
      run(() => window.lsBridge!.syncSubmissions(graderAssignmentId)),

    /**
     * Push all graded scores for an assignment back to Learning Suite.
     */
    pushGrades: (graderAssignmentId: number) =>
      run(() => window.lsBridge!.pushGrades(graderAssignmentId)),
  };
}
