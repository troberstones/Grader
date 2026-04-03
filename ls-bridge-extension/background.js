/**
 * background.js — MV3 Service Worker
 *
 * Acts as the message router between:
 *   • inject.js / content_grader.js  (grader app tab)
 *   • content_ls.js                   (Learning Suite tab)
 */

const DEFAULT_GRADER_ORIGIN = 'http://localhost:3000';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getGraderOrigin() {
  const { graderOrigin } = await chrome.storage.local.get('graderOrigin');
  return graderOrigin || DEFAULT_GRADER_ORIGIN;
}

async function getLSTab() {
  const tabs = await chrome.tabs.query({ url: 'https://learningsuite.byu.edu/*' });
  if (!tabs.length) {
    throw new Error('No Learning Suite tab found. Open Learning Suite in this browser first.');
  }
  return tabs[0];
}

/**
 * Parse subsessionID and courseID directly from an LS tab URL.
 * Same regex as content_ls.js detectPageState() — single source of truth would
 * be cleaner but background can't import from content scripts.
 */
function parseLsState(url) {
  if (!url) return null;
  const subsessionMatch = url.match(/\/\.([A-Za-z0-9]+)\//);
  const courseMatch     = url.match(/\/cid-([a-zA-Z0-9-]+)\//);
  if (!subsessionMatch || !courseMatch) return null;
  return { subsessionID: subsessionMatch[1], courseID: courseMatch[1] };
}

function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

async function sendToLS(message) {
  const tab = await getLSTab();
  const graderOrigin = await getGraderOrigin();
  return sendToTab(tab.id, { ...message, graderOrigin });
}

// ─── Persistent port handler (keeps SW alive during sync) ────────────────────

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'grader-sync') return;
  port.onMessage.addListener(async (msg) => {
    try {
      const result = await handleMessage(msg);
      port.postMessage({ ok: true, result });
    } catch (err) {
      port.postMessage({ ok: false, error: err.message });
    }
  });
});

// ─── One-shot message handler ────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message }));
  return true;
});

async function handleMessage(msg) {
  switch (msg.action) {
    // ── Status ───────────────────────────────────────────────────────────────
    case 'STATUS': {
      const tabs = await chrome.tabs.query({ url: 'https://learningsuite.byu.edu/*' });
      const graderOrigin = await getGraderOrigin();
      if (!tabs.length) {
        return { lsTabOpen: false, lsState: null, graderOrigin };
      }
      // Derive lsState live from the tab URL — never stale, no storage needed.
      const lsState = parseLsState(tabs[0].url);
      return { lsTabOpen: true, lsState, graderOrigin };
    }

    // ── Config ───────────────────────────────────────────────────────────────
    case 'GET_GRADER_ORIGIN': {
      return { origin: await getGraderOrigin() };
    }

    case 'SET_GRADER_ORIGIN': {
      await chrome.storage.local.set({ graderOrigin: msg.origin });
      return { ok: true };
    }

    // ── Forwarded to LS tab ───────────────────────────────────────────────────
    case 'GET_ROSTER':
    case 'GET_ASSIGNMENTS':
    case 'SYNC_SUBMISSIONS':
    case 'PUSH_GRADES':
      return await sendToLS(msg);

    default:
      throw new Error(`Unknown action: ${msg.action}`);
  }
}
