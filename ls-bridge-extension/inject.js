/**
 * inject.js — runs in the MAIN world of the grader app tab
 *
 * Exposes window.lsBridge so React components can call LS sync operations
 * without knowing anything about the Chrome extension internals.
 *
 * Communication with the ISOLATED content_grader.js uses window.postMessage
 * because the two worlds cannot share objects.
 *
 * All methods return Promises.
 */

(function () {
  if (window.__lsBridgeInjected) return;
  window.__lsBridgeInjected = true;

  // ─── Internal request/response bus ────────────────────────────────────────

  const pending = new Map(); // requestId → { resolve, reject }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const { type, requestId, result, error } = event.data ?? {};
    if (type !== 'LS_BRIDGE_RESPONSE') return;

    const p = pending.get(requestId);
    if (!p) return;
    pending.delete(requestId);

    if (error) p.reject(new Error(error));
    else p.resolve(result);
  });

  function request(action, payload = {}) {
    return new Promise((resolve, reject) => {
      const requestId = Math.random().toString(36).slice(2) + Date.now();
      pending.set(requestId, { resolve, reject });
      window.postMessage({ type: 'LS_BRIDGE_REQUEST', requestId, action, ...payload }, '*');
      // Timeout after 60 s (submission downloads can be slow)
      setTimeout(() => {
        if (pending.has(requestId)) {
          pending.delete(requestId);
          reject(new Error(`LS Bridge request "${action}" timed out`));
        }
      }, 60_000);
    });
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  window.lsBridge = {
    /**
     * Check extension presence and LS tab status.
     * Returns { lsTabOpen: boolean, lsState: { subsessionID, courseID } | null, graderOrigin: string }
     */
    getStatus() {
      return request('STATUS');
    },

    /**
     * Fetch the full class roster from LS and sync it into the grader for
     * the given courseId.
     * Returns { imported: number, updated: number }
     */
    syncRoster(courseId) {
      return request('GET_ROSTER', { courseId });
    },

    /**
     * Fetch assignments from LS gradebook and sync them for the given courseId.
     * Requires the LS gradebook page to be open so we can auto-detect gradebookID.
     * Returns { added: number, updated: number, assignments: [...] }
     */
    syncAssignments(courseId, gradebookID) {
      return request('GET_ASSIGNMENTS', { courseId, gradebookID });
    },

    /**
     * Download all student submission files for an assignment from LS and
     * upload them into the grader.
     * graderAssignmentId: internal grader assignment DB id
     * Returns { synced: number, errors: [...] }
     */
    syncSubmissions(graderAssignmentId) {
      return request('SYNC_SUBMISSIONS', { graderAssignmentId });
    },

    /**
     * Push all graded scores for an assignment back to Learning Suite.
     * graderAssignmentId: internal grader assignment DB id
     * Returns { pushed: number, errors: [...] }
     */
    pushGrades(graderAssignmentId) {
      return request('PUSH_GRADES', { graderAssignmentId });
    },
  };
})();
