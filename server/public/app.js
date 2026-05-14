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
// state.panel          : { container, term, fitAddon, ws } for the single xterm panel
// state.windows        : last windows list
// state.activeWindow   : active window index (matches tmux active)
// state.sessionsById   : last-fetched session metadata
// state.windowsTimer   : interval for windows polling
let state = {
  current: null,
  panel: null,
  windows: [],
  activeWindow: null,
  sessionsById: new Map(),
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

  // Header row
  const header = document.createElement('div');
  header.className = 'session-row';
  li.appendChild(header);

  const dot = document.createElement('div');
  dot.className = 'session-dot';
  header.appendChild(dot);

  const name = document.createElement('div');
  name.className = 'session-name';
  name.textContent = s.name;
  header.appendChild(name);

  const count = document.createElement('span');
  count.className = 'session-count';
  header.appendChild(count);

  // status icon slot (spinner / check / attached-dot / nothing)
  const icon = document.createElement('div');
  icon.className = 'session-status-icon';
  icon.dataset.type = '';
  header.appendChild(icon);

  const del = document.createElement('button');
  del.className = 'session-delete';
  del.type = 'button';
  del.textContent = '×';
  del.title = '세션 종료';
  del.addEventListener('click', (ev) => {
    ev.stopPropagation();
    killSession(s.name);
  });
  header.appendChild(del);

  header.addEventListener('click', () => selectSession(s.name));

  // Nested window list
  const subList = document.createElement('ul');
  subList.className = 'window-sublist';
  li.appendChild(subList);

  updateSessionItem(li, s);
  return li;
}

function updateSessionItem(li, s) {
  // selection
  const selected = (s.name === state.current);
  if (li.classList.contains('selected') !== selected) {
    li.classList.toggle('selected', selected);
  }

  const header = li.querySelector('.session-row');
  const dot = header && header.querySelector('.session-dot');
  const wantDotClass = `session-dot ${s.status}`;
  if (dot && dot.className !== wantDotClass) dot.className = wantDotClass;
  if (dot && dot.title !== s.status) dot.title = s.status;

  // window count badge
  const countEl = header && header.querySelector('.session-count');
  const wins = s.windows || [];
  if (countEl) {
    const want = `(${wins.length})`;
    if (countEl.textContent !== want) countEl.textContent = want;
  }

  // status icon slot
  const icon = header && header.querySelector('.session-status-icon');
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

  // sub-list of windows (diffed)
  const subList = li.querySelector('.window-sublist');
  if (subList) updateWindowSublist(subList, s.name, wins);
}

function updateWindowSublist(ul, sessionName, windows) {
  const existing = new Map();
  for (const el of Array.from(ul.children)) {
    if (el.dataset.idx != null) existing.set(parseInt(el.dataset.idx, 10), el);
  }
  for (const w of windows) {
    let el = existing.get(w.index);
    if (!el) {
      el = document.createElement('li');
      el.className = 'window-row';
      el.dataset.idx = String(w.index);
      const idxEl = document.createElement('span');
      idxEl.className = 'window-row-idx';
      idxEl.textContent = `#${w.index}`;
      const nameEl = document.createElement('span');
      nameEl.className = 'window-row-name';
      nameEl.textContent = w.name || `window-${w.index}`;
      el.appendChild(idxEl);
      el.appendChild(nameEl);
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (state.current !== sessionName) {
          selectSession(sessionName);
          // selectSession opens panel; queue window switch after a tick
          setTimeout(() => selectWindow(w.index), 50);
        } else {
          selectWindow(w.index);
        }
      });
      ul.appendChild(el);
    } else {
      existing.delete(w.index);
      const nameEl = el.querySelector('.window-row-name');
      const wantName = w.name || `window-${w.index}`;
      if (nameEl && nameEl.textContent !== wantName) nameEl.textContent = wantName;
    }
    const wantActive = !!w.active && state.current === sessionName;
    if (el.classList.contains('active') !== wantActive) {
      el.classList.toggle('active', wantActive);
    }
  }
  for (const el of existing.values()) el.remove();
  // re-order to match windows[]
  for (let i = 0; i < windows.length; i++) {
    const want = ul.querySelector(`[data-idx="${windows[i].index}"]`);
    if (want && ul.children[i] !== want) {
      ul.insertBefore(want, ul.children[i] || null);
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
      closePanel();
      state.windows = [];
      state.activeWindow = null;
      showEmptyState();
    }
    await fetchSessions();
  } catch (e) {
    alert('요청 실패: ' + e.message);
  }
}

function ensureTerminalShell() {
  if (mainContentEl.classList.contains('terminal-shell')) return;
  mainContentEl.className = 'terminal-shell';
  mainContentEl.innerHTML = `
    <div class="window-tabs" id="windowTabs"></div>
    <div class="terminal-card">
      <div id="terminal"></div>
    </div>`;
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

function closePanel() {
  const p = state.panel;
  if (!p) return;
  if (p.ws) { try { p.ws.close(); } catch (_) {} }
  if (p.term) { try { p.term.dispose(); } catch (_) {} }
  state.panel = null;
}

function openPanel(sessionName) {
  closePanel();
  ensureTerminalShell();
  const termEl = document.getElementById('terminal');
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
  term.open(termEl);
  fitAddon.fit();

  const { cols, rows } = term;
  const wsUrl = `ws://${location.host}/ws?session=${encodeURIComponent(sessionName)}&cols=${cols}&rows=${rows}`;
  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';
  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') term.write(ev.data);
    else term.write(new Uint8Array(ev.data));
  };
  ws.onclose = () => term.writeln('\r\n\x1b[2m[sgtmux] disconnected.\x1b[0m');
  term.onData((d) => { if (ws.readyState === 1) ws.send(d); });

  state.panel = { term, fitAddon, ws };
}

function renderWindowTabs() {
  const tabsEl = document.getElementById('windowTabs');
  if (!tabsEl) return;

  // diff against existing children for stability (avoid full re-create flicker)
  const existing = new Map();
  for (const el of Array.from(tabsEl.children)) {
    if (el.dataset.idx != null) existing.set(parseInt(el.dataset.idx, 10), el);
  }

  for (const w of state.windows) {
    let el = existing.get(w.index);
    if (!el) {
      el = document.createElement('div');
      el.className = 'window-tab';
      el.dataset.idx = String(w.index);
      const idx = document.createElement('span');
      idx.className = 'window-tab-idx';
      idx.textContent = `#${w.index}`;
      const name = document.createElement('span');
      name.className = 'window-tab-name';
      name.textContent = w.name || `window-${w.index}`;
      const kill = document.createElement('button');
      kill.className = 'window-tab-kill';
      kill.type = 'button';
      kill.textContent = '×';
      kill.title = '윈도우 종료';
      kill.addEventListener('click', (ev) => {
        ev.stopPropagation();
        killWindow(state.current, w.index);
      });
      el.appendChild(idx);
      el.appendChild(name);
      el.appendChild(kill);
      el.addEventListener('click', () => selectWindow(w.index));
      tabsEl.appendChild(el);
    } else {
      existing.delete(w.index);
      const nameEl = el.querySelector('.window-tab-name');
      const wantName = w.name || `window-${w.index}`;
      if (nameEl && nameEl.textContent !== wantName) nameEl.textContent = wantName;
    }
    el.classList.toggle('active', !!w.active);
  }
  // remove vanished
  for (const el of existing.values()) el.remove();

  // ensure order matches state.windows
  for (let i = 0; i < state.windows.length; i++) {
    const want = tabsEl.querySelector(`[data-idx="${state.windows[i].index}"]`);
    if (want && tabsEl.children[i] !== want) {
      tabsEl.insertBefore(want, tabsEl.children[i] || null);
    }
  }
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
  state.windows = windows;
  const active = windows.find(w => w.active);
  state.activeWindow = active ? active.index : null;
  renderWindowTabs();

  // if 0 windows (session has none — shouldn't happen with tmux), empty
  if (windows.length === 0) {
    closePanel();
    showEmptyState();
  }
}

async function selectWindow(idx) {
  if (!state.current) return;
  if (state.activeWindow === idx) return;
  try {
    await fetch(`/api/sessions/${encodeURIComponent(state.current)}/windows/${idx}/select`, { method: 'POST' });
    // optimistic: mark this idx active until next poll
    state.activeWindow = idx;
    state.windows = state.windows.map(w => ({ ...w, active: w.index === idx }));
    renderWindowTabs();
    refreshWindows();
  } catch (e) {
    alert('윈도우 전환 실패: ' + e.message);
  }
}

async function killWindow(sessionName, idx) {
  if (!confirm(`window #${idx}를 종료할까요?`)) return;
  try {
    await fetch(`/api/sessions/${encodeURIComponent(sessionName)}/windows/${idx}/kill`, { method: 'POST' });
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

  openPanel(name);
  state.windows = [];
  renderWindowTabs();
  refreshWindows();

  // refresh sidebar styles
  document.querySelectorAll('.session-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.name === name);
  });
}

function startWindowsPolling() {
  if (state.windowsTimer) clearInterval(state.windowsTimer);
  state.windowsTimer = setInterval(() => {
    if (state.current) refreshWindows();
  }, WINDOWS_POLL_MS);
}

window.addEventListener('resize', () => {
  const p = state.panel;
  if (!p) return;
  try {
    p.fitAddon.fit();
    const { cols, rows } = p.term;
    if (p.ws && p.ws.readyState === 1) {
      p.ws.send(JSON.stringify({ resize: [cols, rows] }));
    }
  } catch (_) {}
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
    await refreshWindows();
    // tmux may need a tick to register; refresh once more shortly after
    setTimeout(refreshWindows, 300);
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
