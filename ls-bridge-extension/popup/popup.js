const dot         = document.getElementById('ls-dot');
const title       = document.getElementById('ls-status-title');
const desc        = document.getElementById('ls-status-desc');
const infoBox     = document.getElementById('ls-info');
const semesterEl  = document.getElementById('ls-semester');
const courseEl    = document.getElementById('ls-course');
const originInput = document.getElementById('grader-origin');
const saveBtn     = document.getElementById('save-origin');

function setStatus(color, titleText, descText) {
  dot.className = `dot ${color}`;
  title.textContent = titleText;
  desc.textContent  = descText;
}

async function refresh() {
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'STATUS' });

    // Load saved grader origin
    originInput.value = resp.graderOrigin || 'http://localhost:3000';

    if (!resp.lsTabOpen) {
      setStatus('yellow', 'No Learning Suite tab', 'Open learningsuite.byu.edu in this browser.');
      infoBox.style.display = 'none';
      return;
    }

    setStatus('green', 'Ready', 'Learning Suite tab is open.');

    if (resp.lsState) {
      semesterEl.textContent = resp.lsState.subsessionID || '–';
      courseEl.textContent   = resp.lsState.courseID || '–';
      infoBox.style.display  = 'block';
    }
  } catch (err) {
    setStatus('red', 'Extension error', err.message);
  }
}

/** Declared in host_permissions already — no runtime grant needed for these. */
function isBuiltInOrigin(origin) {
  return /^https?:\/\/localhost(:\d+)?$/.test(origin);
}

saveBtn.addEventListener('click', async () => {
  const origin = originInput.value.trim().replace(/\/$/, '');
  if (!origin) return;

  if (!isBuiltInOrigin(origin)) {
    // A real campus deployment isn't localhost and isn't in host_permissions
    // by default — request it now (matched against optional_host_permissions
    // in manifest.json) so background.js's fetch to this origin can actually
    // carry the grader session cookie later. Cross-origin credentialed
    // requests only work for hosts the extension has permission for.
    if (!/^https:\/\//.test(origin)) {
      setStatus('red', 'https required', 'Enter an https:// URL for anything other than localhost.');
      return;
    }
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    } catch (err) {
      setStatus('red', 'Permission error', err.message);
      return;
    }
    if (!granted) {
      setStatus('red', 'Permission needed', 'Grant access to this origin to sync with it.');
      return;
    }
  }

  await chrome.runtime.sendMessage({ action: 'SET_GRADER_ORIGIN', origin });
  saveBtn.textContent = 'Saved ✓';
  setTimeout(() => (saveBtn.textContent = 'Save'), 1500);
});

refresh();
