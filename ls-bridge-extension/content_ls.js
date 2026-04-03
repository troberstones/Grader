/**
 * content_ls.js — runs inside the Learning Suite tab (ISOLATED world)
 *
 * Responsibilities:
 *  1. Detect subsessionID, courseID, and gradebookID from the page
 *  2. Make LS ajax.php API calls using the live session cookies
 *  3. Fetch student submission files and POST them to the grader API
 *  4. Push grades back to LS
 *
 * NOTE: This script runs in the ISOLATED extension world but has access to
 * document and can read window globals via a tiny injected probe script.
 */

// ─── Page state detection ────────────────────────────────────────────────────

function detectPageState() {
  const url = window.location.href;

  // URL format: /.YN21/cid-0b7-z8GYaOqO/... (subsession IDs may contain lower or uppercase)
  const subsessionMatch = url.match(/\/\.([\w-]+)\//);
  const courseMatch = url.match(/\/cid-([a-zA-Z0-9-]+)\//);

  const subsessionID = subsessionMatch?.[1] ?? null;
  const courseID = courseMatch?.[1] ?? null;

  return { subsessionID, courseID };
}

/**
 * Discover the gradebookID by trying several LS API strategies in order.
 *
 * Strategy 1 — getScoresPageData: the page-load call; may contain gradebookID
 *              directly or via JSON key search.
 * Strategy 2 — getAssignments with no ID: each assignment object carries its
 *              own gradebookID field, so the first result reveals it.
 * Strategy 3 — getGradebooks / getAll on the gradebook model endpoint.
 */
async function fetchGradebookId(subsessionID) {
  // ── Strategy 1: scores page data ──────────────────────────────────────────
  try {
    const data = await lsPost(
      'ajax/gradebook/scoresPage.php',
      'gradebook',
      subsessionID,
      { funcName: 'getScoresPageData', 'funcParams[noParams]': 'true' }
    );
    const id = extractGradebookIdFromObject(data);
    if (id) return id;
  } catch (e) { /* try next */ }

  // ── Strategy 2: assignment list (each assignment carries its gradebookID) ─
  for (const funcParams of [
    { funcName: 'getAssignments', 'funcParams[gradebookID]': '' },
    { funcName: 'getAssignments' },
  ]) {
    try {
      const data = await lsPost(
        'ajax/assignments/AssignmentData.php',
        'gradebook',
        subsessionID,
        funcParams
      );
      const list = Array.isArray(data) ? data : Object.values(data || {});
      for (const item of list) {
        if (typeof item !== 'object' || !item) continue;
        const id = item.gradebookID ?? item.lmsGradebookId ?? item.gbId;
        if (id != null) return String(id);
      }
    } catch (e) { /* try next */ }
  }

  // ── Strategy 3: gradebook listing endpoints ────────────────────────────────
  for (const [url, func] of [
    ['ajax/gradebook/GradebookData.php',        'getGradebooks'],
    ['ajax/models/lsgradebook/gradebook.php',   'getAll'],
    ['ajax/models/lsgradebook/gradebook.php',   'getGradebooks'],
  ]) {
    try {
      const data = await lsPost(url, 'gradebook', subsessionID, { funcName: func });
      const list = Array.isArray(data) ? data : Object.values(data || {});
      for (const item of list) {
        if (typeof item !== 'object' || !item) continue;
        const id = item.gradebookID ?? item.id ?? item.gbId;
        if (id != null) return String(id);
      }
    } catch (e) { /* try next */ }
  }

  return null;
}

/** Recursively search a parsed JSON object for a gradebookID-like field. */
function extractGradebookIdFromObject(data) {
  if (!data || typeof data !== 'object') return null;

  const directKeys = ['gradebookID', 'gradebook_id', 'gbId', 'gb_id'];
  for (const key of directKeys) {
    if (data[key] != null) return String(data[key]);
  }

  // One level of nesting
  for (const val of Object.values(data)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      for (const key of directKeys) {
        if (val[key] != null) return String(val[key]);
      }
    }
  }

  // JSON key search as last resort
  try {
    const json = JSON.stringify(data);
    const m = json.match(/"(?:gradebookID|gradebook_id|gbId|gb_id)"\s*:\s*"?([A-Za-z0-9_-]{4,40})"?/);
    if (m) return m[1];
  } catch (e) { /* ignore */ }

  return null;
}

// ─── LS API calls ─────────────────────────────────────────────────────────────

function lsPost(url, appId, subsessionID, params) {
  return fetch(`/ajax.php?appId=${appId}&subsessionID=${subsessionID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      classname: '',
      contructorParams: '',
      isPage: 'false',
      url,
      ...params,
    }),
    credentials: 'same-origin',
  }).then(async (r) => {
    if (!r.ok) throw new Error(`LS API returned ${r.status}`);
    const text = await r.text();
    try {
      return JSON.parse(text);
    } catch {
      // LS returned HTML — most likely a session-expired login redirect
      throw new Error('Learning Suite returned an unexpected response. Your session may have expired — please reload the Learning Suite tab and try again.');
    }
  });
}

async function getRoster(subsessionID) {
  const data = await lsPost(
    'ajax/course/usersAjax.php',
    'home',
    subsessionID,
    { funcName: 'getStudents', 'funcParams[noParams]': 'true' }
  );

  // Response is keyed by "LastName, FirstName_netID"
  // Each value has: netId, email, sectionID, etc. Name fields vary by LS version.
  const students = [];
  for (const [key, student] of Object.entries(data)) {
    if (typeof student !== 'object' || !student.netId) continue;

    // Extract sortName from the key ("LastName, FirstName_netID" → "LastName, FirstName")
    const netIdSuffix = `_${student.netId}`;
    const sortNameFromKey = key.endsWith(netIdSuffix)
      ? key.slice(0, -netIdSuffix.length)
      : key;

    // LS uses different name fields depending on version — try them all
    const name =
      student.fullname ?? student.fullName ?? student.name ??
      student.displayName ?? student.preferredName ?? sortNameFromKey;
    const sortName = student.sortName ?? sortNameFromKey;

    students.push({
      netId: student.netId,
      name,
      sortName,
      email: student.email ?? null,
      lmsStudentId: String(student.studentID ?? student.userID ?? ''),
      section: student.sectionID ?? null,
    });
  }
  return students;
}

async function getAssignments(subsessionID, gradebookID) {
  const data = await lsPost(
    'ajax/assignments/AssignmentData.php',
    'gradebook',
    subsessionID,
    { funcName: 'getAssignments', 'funcParams[gradebookID]': gradebookID }
  );

  // data is an array or object of assignments
  const list = Array.isArray(data) ? data : Object.values(data);
  return list.map((a) => ({
    lmsAssignmentId: String(a.id),
    lmsGradebookId: String(a.gradebookID ?? gradebookID),
    name: a.name,
    points: Number(a.points ?? a.pointsPossible ?? 0),
    dueDate: a.dueDate ?? null,
    categoryId: String(a.categoryID ?? ''),
    type: a.type ?? 'assignment',
    hasOnlineSubmission: Boolean(a.onlineSubmission),
  }));
}

/**
 * Get student submissions for an assignment via the LS discussion system.
 *
 * LS stores assignment submissions as discussion posts. Each assignment is
 * linked to a discussion via assignmentIDs map. Student file uploads are
 * comment.files on top-level comments (parentID === null).
 */
async function getSubmissionsForAssignment(subsessionID, lmsAssignmentId) {
  // Step 1: fetch the common discussion data (includes all discussions + assignmentIDs map).
  // Calling with empty url/discussID returns common data without a specific discussion's comments.
  let commonData;
  try {
    commonData = await lsPost(
      'pages/discuss/ViewDiscussionVue.php',
      'discuss',
      subsessionID,
      {
        funcName: 'getAjaxableDiscussionInfo',
        'funcParams[url]': '',
        'funcParams[discussID]': '',
        'funcParams[groupID]': '',
        'funcParams[studentID]': '',
      }
    );
  } catch (e) {
    throw new Error(`Could not fetch discussion list from LS: ${e.message}`);
  }

  // assignmentIDs: { discussionID → assignmentID }
  const assignmentIDs = commonData.assignmentIDs ?? {};
  const discussions = Array.isArray(commonData.discussions) ? commonData.discussions : [];

  // Find the discussion linked to our lmsAssignmentId
  let targetDiscussionId = null;
  for (const [discussID, assignID] of Object.entries(assignmentIDs)) {
    if (String(assignID) === String(lmsAssignmentId)) {
      targetDiscussionId = discussID;
      break;
    }
  }

  if (!targetDiscussionId) {
    const knownIds = Object.values(assignmentIDs).join(', ') || 'none found';
    throw new Error(
      `No LS discussion is linked to assignment ID "${lmsAssignmentId}". ` +
      `Make sure the assignment was synced from LS. Known assignment IDs: ${knownIds}`
    );
  }

  const targetDiscussion = discussions.find((d) => d.id === targetDiscussionId);
  const discussionUrl = targetDiscussion?.url ?? '';

  // Step 2: fetch the full submission data (comments + students) for this discussion
  const data = await lsPost(
    'pages/discuss/ViewDiscussionVue.php',
    'discuss',
    subsessionID,
    {
      funcName: 'getAjaxableDiscussionInfo',
      'funcParams[url]': discussionUrl,
      'funcParams[discussID]': targetDiscussionId,
      'funcParams[groupID]': '',
      'funcParams[studentID]': '',
    }
  );

  // Map LS ownerID → sortName from the discussion's student roster
  const lsStudents = Array.isArray(data.students) ? data.students : [];
  const sortNameById = {};
  for (const s of lsStudents) {
    if (s.id) sortNameById[String(s.id)] = s.sortName ?? s.fullPreferredName ?? null;
  }

  // Extract top-level submissions (parentID === null) that have attached files
  const comments = Array.isArray(data.comments) ? data.comments : [];
  const submissions = [];

  for (const comment of comments) {
    if (comment.parentID !== null) continue; // skip replies
    if (!Array.isArray(comment.files) || comment.files.length === 0) continue;

    const ownerID = String(comment.ownerID ?? '');
    const sortName = sortNameById[ownerID] ?? null;

    for (const file of comment.files) {
      const downloadUrl =
        `/plugins/Upload/fileDownload.php` +
        `?fileId=${encodeURIComponent(file.id)}` +
        `&discussionId=${encodeURIComponent(comment.discussionID)}` +
        `&comment=1&downloadSource=discussions&download=true` +
        `&subsessionID=${encodeURIComponent(subsessionID)}&appId=discuss`;

      submissions.push({
        lmsStudentId: ownerID,  // LS user ID — may match DB lmsStudentId if populated
        sortName,               // used as fallback matching key
        fileName: file.filename ?? file.name ?? null,
        fileType: null,
        downloadUrl,
        submittedAt: comment.timePosted ?? null,
      });
    }
  }

  return submissions;

  const list = Array.isArray(data) ? data : Object.values(data ?? {});
  return list.map((s) => ({
    lmsStudentId: String(s.studentID ?? s.userID ?? ''),
    fileName: s.fileName ?? s.name ?? null,
    fileType: s.fileType ?? s.mimeType ?? null,
    // LS likely returns a path or token — try common field names
    downloadUrl: s.fileURL ?? s.downloadURL ?? s.url ?? s.filePath ?? null,
    submittedAt: s.submittedAt ?? s.submitDate ?? null,
  })).filter((s) => s.lmsStudentId && s.downloadUrl);
}

/**
 * Fetch a submission file from LS (same-origin, so session cookies work)
 * and POST it directly to the grader's upload endpoint.
 */
async function fetchAndRelaySubmission(
  downloadUrl,
  fileName,
  graderOrigin,
  graderAssignmentId,
  graderStudentId
) {
  // downloadUrl may be relative or absolute
  const fetchUrl = downloadUrl.startsWith('http') ? downloadUrl : `https://learningsuite.byu.edu${downloadUrl}`;

  const fileResp = await fetch(fetchUrl, { credentials: 'same-origin' });
  if (!fileResp.ok) throw new Error(`Failed to download submission: ${fileResp.status}`);

  const blob = await fileResp.blob();
  const file = new File([blob], fileName || 'submission', { type: blob.type });

  const form = new FormData();
  form.append('file', file);
  form.append('assignmentId', String(graderAssignmentId));
  form.append('studentId', String(graderStudentId));

  const uploadResp = await fetch(`${graderOrigin}/api/submissions/upload`, {
    method: 'POST',
    body: form,
  });

  if (!uploadResp.ok) {
    const text = await uploadResp.text();
    throw new Error(`Grader upload failed: ${uploadResp.status} ${text}`);
  }

  return await uploadResp.json();
}

async function pushGrade(subsessionID, gradebookID, lmsStudentId, lmsAssignmentId, score, note) {
  return lsPost(
    'ajax/models/lsgradebook/score.php',
    'gradebook',
    subsessionID,
    {
      funcName: 'create',
      'funcParams[studentID]': lmsStudentId,
      'funcParams[gradebookID]': gradebookID,
      'funcParams[assignmentID]': lmsAssignmentId,
      'funcParams[score]': String(score),
      'funcParams[excuse]': 'false',
      'funcParams[note]': note ?? '',
    }
  );
}

// ─── Message listener ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleRequest(msg)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message }));
  return true;
});

async function handleRequest(msg) {
  // background.js injects subsessionID + courseID from the tab URL (more reliable).
  // Fall back to local URL detection only if they weren't provided.
  const pageState = detectPageState();
  const subsessionID = msg.subsessionID ?? pageState.subsessionID;
  const courseID     = msg.courseID     ?? pageState.courseID;

  if (!subsessionID) {
    throw new Error('Could not detect subsessionID from the Learning Suite URL. Navigate to a course page.');
  }

  switch (msg.action) {
    case 'GET_ROSTER': {
      const students = await getRoster(subsessionID);
      return { students, subsessionID, courseID };
    }

    case 'GET_ASSIGNMENTS': {
      // gradebookID: prefer what caller provided, then ask LS directly
      let gradebookID = msg.gradebookID;
      if (!gradebookID) {
        gradebookID = await fetchGradebookId(subsessionID);
      }
      if (!gradebookID) {
        throw new Error(
          'Could not determine gradebookID. Make sure you are on the Learning Suite Grades > Scores page and try again.'
        );
      }
      const assignments = await getAssignments(subsessionID, gradebookID);
      return { assignments, gradebookID, subsessionID, courseID };
    }

    case 'SYNC_SUBMISSIONS': {
      const { graderOrigin, graderAssignmentId, lmsAssignmentId, studentMap } = msg;
      // studentMap: [{ graderStudentId, lmsStudentId, sortName, netId }, ...]

      const lsSubmissions = await getSubmissionsForAssignment(subsessionID, lmsAssignmentId);

      const results = [];
      const errors = [];

      for (const sub of lsSubmissions) {
        // Match by lmsStudentId first (if the DB has it), then by sortName as fallback
        const mapping = studentMap.find((s) =>
          (s.lmsStudentId && s.lmsStudentId === sub.lmsStudentId) ||
          (s.sortName && s.sortName === sub.sortName)
        );
        if (!mapping) {
          errors.push({ lmsStudentId: sub.lmsStudentId, sortName: sub.sortName, error: 'No matching student in grader' });
          continue;
        }

        try {
          const result = await fetchAndRelaySubmission(
            sub.downloadUrl,
            sub.fileName,
            graderOrigin,
            graderAssignmentId,
            mapping.graderStudentId
          );
          results.push({ lmsStudentId: sub.lmsStudentId, graderStudentId: mapping.graderStudentId, submission: result.submission });
        } catch (e) {
          errors.push({ lmsStudentId: sub.lmsStudentId, error: e.message });
        }
      }

      return { synced: results.length, results, errors };
    }

    case 'PUSH_GRADES': {
      // grades: [{ lmsStudentId, lmsAssignmentId, gradebookID, score, note }, ...]
      const { grades } = msg;
      const results = [];
      const errors = [];

      for (const g of grades) {
        try {
          await pushGrade(subsessionID, g.gradebookID, g.lmsStudentId, g.lmsAssignmentId, g.score, g.note);
          results.push({ lmsStudentId: g.lmsStudentId, score: g.score });
        } catch (e) {
          errors.push({ lmsStudentId: g.lmsStudentId, error: e.message });
        }
      }

      return { pushed: results.length, results, errors };
    }

    default:
      throw new Error(`Unknown action: ${msg.action}`);
  }
}

// No longer needed — background derives lsState directly from the tab URL.
