/**
 * content_grader.js — runs in the ISOLATED world of the grader app tab
 *
 * Bridges:
 *   window.postMessage  (from inject.js in MAIN world)
 *         ↕
 *   chrome.runtime.sendMessage  (to background.js service worker)
 *
 * For SYNC_SUBMISSIONS and PUSH_GRADES, this script also calls the grader's
 * own API to gather the necessary student/assignment data before forwarding
 * the request to LS.
 */

window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  const { type, requestId, action, ...payload } = event.data ?? {};
  if (type !== 'LS_BRIDGE_REQUEST') return;

  try {
    const result = await handleRequest(action, payload);
    window.postMessage({ type: 'LS_BRIDGE_RESPONSE', requestId, result }, '*');
  } catch (err) {
    window.postMessage({ type: 'LS_BRIDGE_RESPONSE', requestId, error: err.message }, '*');
  }
});

function sendToBackground(message) {
  return new Promise((resolve, reject) => {
    let port;
    try {
      port = chrome.runtime.connect({ name: 'grader-sync' });
    } catch (err) {
      reject(new Error('Could not reach the LS Bridge extension. Reload this tab and the Learning Suite tab, then try again.'));
      return;
    }

    const timeout = setTimeout(() => {
      port.disconnect();
      reject(new Error(`LS Bridge request "${message.action}" timed out after 60s`));
    }, 60_000);

    port.onMessage.addListener((msg) => {
      clearTimeout(timeout);
      port.disconnect();
      if (msg.ok) resolve(msg.result);
      else reject(new Error(msg.error));
    });

    port.onDisconnect.addListener(() => {
      clearTimeout(timeout);
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error('Could not reach the LS Bridge extension. Reload this tab and the Learning Suite tab, then try again.'));
      }
      // If no error, the port was disconnected by us after onMessage fired — no-op.
    });

    port.postMessage(message);
  });
}

async function graderFetch(path, options = {}) {
  const resp = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Grader API error ${resp.status}: ${text}`);
  }
  return resp.json();
}

// ─── Request handlers ────────────────────────────────────────────────────────

async function handleRequest(action, payload) {
  switch (action) {
    case 'STATUS':
      return sendToBackground({ action: 'STATUS' });

    // ── Roster sync ────────────────────────────────────────────────────────
    case 'GET_ROSTER': {
      const { courseId } = payload;
      if (!courseId) throw new Error('courseId is required for roster sync');

      // 1. Fetch roster from LS — response includes the detected LS courseID
      const { students, courseID: lsCourseId, subsessionID } = await sendToBackground({ action: 'GET_ROSTER' });

      // 2. POST to grader API — include lsCourseId so the API can verify/auto-link
      const result = await graderFetch('/api/ls-bridge/sync-roster', {
        method: 'POST',
        body: JSON.stringify({ courseId, students, lsCourseId, subsessionID }),
      });

      return result;
    }

    // ── Assignment sync ────────────────────────────────────────────────────
    case 'GET_ASSIGNMENTS': {
      const { courseId, gradebookID } = payload;
      if (!courseId) throw new Error('courseId is required for assignment sync');

      // 1. Fetch assignments from LS — response includes detected LS courseID
      const { assignments, gradebookID: detectedGbId, courseID: lsCourseId, subsessionID } = await sendToBackground({
        action: 'GET_ASSIGNMENTS',
        gradebookID: gradebookID ?? null,
      });

      // 2. POST to grader API — include lsCourseId for verification/auto-link
      const result = await graderFetch('/api/ls-bridge/sync-assignments', {
        method: 'POST',
        body: JSON.stringify({ courseId, assignments, gradebookID: detectedGbId, lsCourseId, subsessionID }),
      });

      return result;
    }

    // ── Submission sync ────────────────────────────────────────────────────
    case 'SYNC_SUBMISSIONS': {
      const { graderAssignmentId } = payload;
      if (!graderAssignmentId) throw new Error('graderAssignmentId is required');

      // 1. Get assignment + enrolled students with LS IDs from grader
      const info = await graderFetch(`/api/ls-bridge/assignment-sync-info?assignmentId=${graderAssignmentId}`);

      if (!info.lmsAssignmentId) {
        throw new Error(
          'This assignment has no Learning Suite ID. Run "Sync Assignments" first to link it.'
        );
      }
      if (!info.gradebookID) {
        throw new Error(
          'No gradebookID stored. Run "Sync Assignments" on the LS gradebook page first.'
        );
      }

      // 2. Ask content_ls.js to fetch each submission and POST to grader
      const result = await sendToBackground({
        action: 'SYNC_SUBMISSIONS',
        lmsAssignmentId: info.lmsAssignmentId,
        gradebookID: info.gradebookID,
        graderAssignmentId,
        studentMap: info.students, // [{ lmsStudentId, graderStudentId }]
      });

      return result;
    }

    // ── Grade push ─────────────────────────────────────────────────────────
    case 'PUSH_GRADES': {
      const { graderAssignmentId } = payload;
      if (!graderAssignmentId) throw new Error('graderAssignmentId is required');

      // 1. Get grades from grader (only graded records)
      const { grades } = await graderFetch(
        `/api/ls-bridge/assignment-sync-info?assignmentId=${graderAssignmentId}&includeGrades=true`
      );

      if (!grades?.length) {
        return { pushed: 0, errors: [], message: 'No graded submissions to push.' };
      }

      // 2. Forward to LS
      const result = await sendToBackground({ action: 'PUSH_GRADES', grades });
      return result;
    }

    default:
      throw new Error(`Unknown LS Bridge action: ${action}`);
  }
}
