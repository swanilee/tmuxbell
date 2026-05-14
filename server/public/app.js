// sgtmux client.
//
// Responsibilities:
//   1) Poll /api/sessions every 1s → render sidebar with status dots.
//   2) On session click, open WebSocket /ws?session=NAME and attach an xterm
//      to the bidirectional pty.
//   3) Resize handling, kill, new-session.
//
// Status dot convention:
//   - active (magenta)  : output detected within IDLE_THRESHOLD on backend
//   - idle (green)      : no output for a while → Claude likely finished
//   - unknown (gray)    : no pty ever attached (or just-created session)

const POLL_MS = 1000;
const WINDOWS_POLL_MS = 1500;

// state.current        : selected session name
// state.panels         : Map<windowIdx, { container, term, fitAddon, ws }>
// state.sessionsById   : last-fetched session metadata
// state.windowsKey     : "indices in current grid"   to detect changes
let state = {
  current: null,
  panels: new Map(),
  sessionsById: new Map(),
  windowsKey: '',
  windowsTimer: null,
};

const $ = (sel) => document.querySelector(sel);
const sessionListEl = $('#sessionList');
const hostEl = $('#host');
const currentEl = $('#currentSession');
const killBtn = $('#killBtn');
const newBtn = $('#newSessionBtn');
const newWindowBtn = $('#newWindowBtn');
const mainContentEl = $('#mainContent');

// Modal
const modal = $('#newWindowModal');
const modalName = $('#newWindowName');
const modalFork = $('#newWindowFork');
const modalCmd = $('#newWindowCmd');
const modalCreate = $('#newWindowCreate');

async function fetchSessions() {
  try {
    const r = await fetch('/api/sessions');
    const j = await r.json();
    hostEl.textContent = j.host || '—';
    renderSessions(j.sessions || []);
  } catch (e) {
    console.error('fetchSessions failed', e);
  }
}

function renderSessions(list) {
  state.sessionsById = new Map(list.map(s => [s.name, s]));

  // empty-state placeholder is a special non-data <li>
  const placeholderClass = 'session-empty-placeholder';
  if (list.length === 0) {
    Array.from(sessionListEl.children).forEach(el => {
      if (!el.classList.contains(placeholderClass)) el.remove();
    });
    if (!sessionListEl.querySelector('.' + placeholderClass)) {
      const li = document.createElement('li');
      li.className = `session-meta ${placeholderClass}`;
      li.style.padding = 'var(--s-sm) var(--s-md)';
      li.textContent = '(세션 없음)';
      sessionListEl.appendChild(li);
    }
    return;
  }
  // remove placeholder if present
  Array.from(sessionListEl.querySelectorAll('.' + placeholderClass)).forEach(el => el.remove());

  // index existing items by name
  const existing = new Map();
  for (const li of Array.from(sessionListEl.children)) {
    const n = li.dataset.name;
    if (n) existing.set(n, li);
  }

  // upsert in the new order
  const ordered = [];
  for (const s of list) {
    let li = existing.get(s.name);
    if (li) {
      updateSessionItem(li, s);
      existing.delete(s.name);
    } else {
      li = createSessionItem(s);
    }
    ordered.push(li);
  }

  // remove vanished
  for (const li of existing.values()) li.remove();

  // sync child order (move only the ones that drifted)
  for (let i = 0; i < ordered.length; i++) {
    if (sessionListEl.children[i] !== ordered[i]) {
      sessionListEl.insertBefore(ordered[i], sessionListEl.children[i] || null);
    }
  }
}

function createSessionItem(s) {
  const li = document.createElement('li');
  li.className = 'session-item';
  li.dataset.name = s.name;

  const dot = document.createElement('div');
  dot.className = 'session-dot';
  li.appendChild(dot);

  const name = document.createElement('div');
  name.className = 'session-name';
  name.textContent = s.name;
  li.appendChild(name);

  // status icon slot (spinner / check / attached-dot / nothing)
  const icon = document.createElement('div');
  icon.className = 'session-status-icon';
  icon.dataset.type = '';
  li.appendChild(icon);

  const del = document.createElement('button');
  del.className = 'session-delete';
  del.type = 'button';
  del.textContent = '×';
  del.title = '세션 종료';
  del.addEventListener('click', (ev) => {
    ev.stopPropagation();
    killSession(s.name);
  });
  li.appendChild(del);

  li.addEventListener('click', () => selectSession(s.name));

  updateSessionItem(li, s);
  return li;
}

function updateSessionItem(li, s) {
  // selection
  const selected = (s.name === state.current);
  if (li.classList.contains('selected') !== selected) {
    li.classList.toggle('selected', selected);
  }

  // status dot class
  const dot = li.firstElementChild; // .session-dot
  const wantDotClass = `session-dot ${s.status}`;
  if (dot && dot.className !== wantDotClass) dot.className = wantDotClass;
  if (dot && dot.title !== s.status) dot.title = s.status;

  // status icon slot — only swap contents when the type changes
  const icon = li.querySelector('.session-status-icon');
  let wantType = 'none';
  if (s.status === 'active') wantType = 'spinner';
  else if (s.hasUnseenCompletion) wantType = 'check';
  else if (s.attached) wantType = 'attached';

  if (icon && icon.dataset.type !== wantType) {
    icon.dataset.type = wantType;
    icon.innerHTML = '';
    if (wantType === 'spinner') {
      const d = document.createElement('div');
      d.className = 'session-spinner';
      d.title = '응답 중';
      icon.appendChild(d);
    } else if (wantType === 'check') {
      const d = document.createElement('div');
      d.className = 'session-check';
      d.textContent = '✓';
      d.title = '응답 완료 — 확인 안 함';
      icon.appendChild(d);
    } else if (wantType === 'attached') {
      const d = document.createElement('div');
      d.className = 'session-meta';
      d.textContent = '●';
      d.title = 'attached';
      icon.appendChild(d);
    }
  }
}

async function killSession(name) {
  if (!confirm(`세션 "${name}"를 종료할까요?`)) return;
  try {
    const r = await fetch(`/api/sessions/${encodeURIComponent(name)}/kill`, { method: 'POST' });
    const j = await r.json();
    if (!j.ok) { alert('종료 실패: ' + (j.error || 'unknown')); return; }
    if (state.current === name) {
      state.current = null;
      currentEl.textContent = '세션을 선택하세요';
      killBtn.hidden = true;
      newWindowBtn.hidden = true;
      closeAllPanels();
      state.windowsKey = '';
      showEmptyState();
    }
    await fetchSessions();
  } catch (e) {
    alert('요청 실패: ' + e.message);
  }
}

function ensureGridView() {
  if (mainContentEl.classList.contains('empty-state') || !mainContentEl.classList.contains('windows-grid')) {
    mainContentEl.className = 'windows-grid';
    mainContentEl.innerHTML = '';
  }
}

function showEmptyState() {
  mainContentEl.className = 'empty-state';
  mainContentEl.innerHTML = `
    <div class="empty-state-card">
      <h2 class="empty-state-title">왼쪽에서 세션을 선택하거나 새로 만드세요</h2>
      <p class="empty-state-body">
        터미널에서 <code>sgtmux</code> 명령으로 새 tmux 세션을 시작할 수 있습니다.
      </p>
    </div>`;
}

function closeAllPanels() {
  for (const [, p] of state.panels) closePanel(p);
  state.panels.clear();
}

function closePanel(p) {
  if (p.ws) { try { p.ws.close(); } catch (_) {} }
  if (p.term) { try { p.term.dispose(); } catch (_) {} }
  if (p.container && p.container.parentNode) p.container.parentNode.removeChild(p.container);
}

function createPanel(sessionName, w) {
  const container = document.createElement('div');
  container.className = 'window-panel';
  container.dataset.window = String(w.index);

  const header = document.createElement('div');
  header.className = 'window-header';
  const idx = document.createElement('div');
  idx.className = 'window-idx';
  idx.textContent = `#${w.index}`;
  const title = document.createElement('div');
  title.className = 'window-title';
  title.textContent = w.name || `window-${w.index}`;
  const kill = document.createElement('button');
  kill.className = 'window-kill';
  kill.type = 'button';
  kill.textContent = '×';
  kill.title = '윈도우 종료';
  kill.addEventListener('click', () => killWindow(sessionName, w.index));
  header.appendChild(idx);
  header.appendChild(title);
  header.appendChild(kill);
  container.appendChild(header);

  const termEl = document.createElement('div');
  termEl.className = 'window-terminal';
  container.appendChild(termEl);

  const term = new Terminal({
    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
    fontSize: 13,
    theme: {
      background: '#15161a',
      foreground: '#f0f0f3',
      cursor: '#f0f0f3',
      selectionBackground: 'rgba(240, 240, 243, 0.18)',
    },
    cursorBlink: true,
    scrollback: 10000,
  });
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);

  mainContentEl.appendChild(container);
  term.open(termEl);
  fitAddon.fit();

  const { cols, rows } = term;
  const wsUrl = `ws://${location.host}/ws?session=${encodeURIComponent(sessionName)}&window=${w.index}&cols=${cols}&rows=${rows}`;
  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';
  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') term.write(ev.data);
    else term.write(new Uint8Array(ev.data));
  };
  ws.onclose = () => term.writeln('\r\n\x1b[2m[sgtmux] disconnected.\x1b[0m');
  term.onData((d) => { if (ws.readyState === 1) ws.send(d); });

  return { container, term, fitAddon, ws, windowIndex: w.index };
}

async function refreshWindows() {
  if (!state.current) return;
  let windows = [];
  try {
    const r = await fetch(`/api/sessions/${encodeURIComponent(state.current)}/windows`);
    const j = await r.json();
    windows = (j.windows || []).sort((a, b) => a.index - b.index);
  } catch (e) {
    return;
  }

  const newKey = windows.map(w => `${w.index}:${w.name}`).join('|');
  if (newKey === state.windowsKey) return;
  state.windowsKey = newKey;

  ensureGridView();

  const present = new Set(windows.map(w => w.index));
  // close panels for windows that disappeared
  for (const [idx, p] of state.panels) {
    if (!present.has(idx)) {
      closePanel(p);
      state.panels.delete(idx);
    }
  }
  // open panels for new windows; update title for existing
  for (const w of windows) {
    if (!state.panels.has(w.index)) {
      state.panels.set(w.index, createPanel(state.current, w));
    } else {
      const p = state.panels.get(w.index);
      const titleEl = p.container.querySelector('.window-title');
      if (titleEl && titleEl.textContent !== (w.name || `window-${w.index}`)) {
        titleEl.textContent = w.name || `window-${w.index}`;
      }
    }
  }

  // re-order panel DOM children to match window index order
  const ordered = windows
    .map(w => state.panels.get(w.index)?.container)
    .filter(Boolean);
  for (let i = 0; i < ordered.length; i++) {
    if (mainContentEl.children[i] !== ordered[i]) {
      mainContentEl.insertBefore(ordered[i], mainContentEl.children[i] || null);
    }
  }

  // if zero windows somehow → empty state
  if (state.panels.size === 0) showEmptyState();
}

async function killWindow(sessionName, idx) {
  if (!confirm(`window #${idx}를 종료할까요?`)) return;
  try {
    await fetch(`/api/sessions/${encodeURIComponent(sessionName)}/windows/${idx}/kill`, { method: 'POST' });
    state.windowsKey = '';
    refreshWindows();
  } catch (e) {
    alert('윈도우 종료 실패: ' + e.message);
  }
}

function selectSession(name) {
  if (state.current === name) return;
  state.current = name;
  currentEl.textContent = name;
  killBtn.hidden = false;
  newWindowBtn.hidden = false;

  closeAllPanels();
  state.windowsKey = '';
  ensureGridView();
  refreshWindows();

  // refresh sidebar styles
  document.querySelectorAll('.session-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.name === name);
  });
}

// Auto-poll windows of the currently selected session.
function startWindowsPolling() {
  if (state.windowsTimer) clearInterval(state.windowsTimer);
  state.windowsTimer = setInterval(() => {
    if (state.current) refreshWindows();
  }, WINDOWS_POLL_MS);
}

window.addEventListener('resize', () => {
  for (const [, p] of state.panels) {
    try {
      p.fitAddon.fit();
      const { cols, rows } = p.term;
      if (p.ws && p.ws.readyState === 1) {
        p.ws.send(JSON.stringify({ resize: [cols, rows] }));
      }
    } catch (_) {}
  }
});

newBtn.addEventListener('click', async () => {
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
  const name = prompt('새 세션 이름:', `claude-${stamp}`);
  if (!name) return;
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    alert('세션 이름은 영숫자/하이픈/언더스코어만 허용됩니다.');
    return;
  }
  try {
    const r = await fetch(`/api/sessions/${encodeURIComponent(name)}/new`, { method: 'POST' });
    const j = await r.json();
    if (!j.ok) { alert('생성 실패: ' + (j.error || 'unknown')); return; }
    await fetchSessions();
    selectSession(name);
  } catch (e) {
    alert('요청 실패: ' + e.message);
  }
});

killBtn.addEventListener('click', () => {
  if (state.current) killSession(state.current);
});

// ── New-window modal ────────────────────────────────────────────────
function openNewWindowModal() {
  modalName.value = '';
  modalCmd.value = '';
  modalFork.checked = true;
  modal.hidden = false;
  setTimeout(() => modalName.focus(), 0);
}
function closeNewWindowModal() { modal.hidden = true; }

newWindowBtn.addEventListener('click', () => {
  if (!state.current) return;
  openNewWindowModal();
});
modal.addEventListener('click', (ev) => {
  if (ev.target.dataset.modalClose !== undefined || ev.target === modal.querySelector('.modal-backdrop')) {
    closeNewWindowModal();
  }
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !modal.hidden) closeNewWindowModal();
});

modalCreate.addEventListener('click', async () => {
  if (!state.current) return;
  const name = modalName.value.trim() || undefined;
  const cmd = modalCmd.value.trim() || undefined;
  const fork = !!modalFork.checked;
  if (name && !/^[A-Za-z0-9_-]+$/.test(name)) {
    alert('윈도우 이름은 영숫자/하이픈/언더스코어만.');
    return;
  }
  modalCreate.disabled = true;
  try {
    const r = await fetch(`/api/sessions/${encodeURIComponent(state.current)}/windows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, cmd, fork }),
    });
    const j = await r.json();
    if (!j.ok) { alert('생성 실패: ' + (j.error || 'unknown')); return; }
    closeNewWindowModal();
    state.windowsKey = '';
    await refreshWindows();
    // tmux may need a tick to register; refresh once more shortly after
    setTimeout(() => { state.windowsKey = ''; refreshWindows(); }, 300);
  } catch (e) {
    alert('요청 실패: ' + e.message);
  } finally {
    modalCreate.disabled = false;
  }
});

startWindowsPolling();

// boot
fetchSessions();
setInterval(fetchSessions, POLL_MS);
