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

saveBtn.addEventListener('click', async () => {
  const origin = originInput.value.trim().replace(/\/$/, '');
  if (!origin) return;
  await chrome.runtime.sendMessage({ action: 'SET_GRADER_ORIGIN', origin });
  saveBtn.textContent = 'Saved ✓';
  setTimeout(() => (saveBtn.textContent = 'Save'), 1500);
});

refresh();
