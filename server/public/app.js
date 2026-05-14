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

let state = {
  current: null,        // selected session name
  term: null,           // xterm instance
  fitAddon: null,
  ws: null,
  sessionsById: new Map(),
};

const $ = (sel) => document.querySelector(sel);
const sessionListEl = $('#sessionList');
const hostEl = $('#host');
const currentEl = $('#currentSession');
const killBtn = $('#killBtn');
const newBtn = $('#newSessionBtn');
const mainContentEl = $('#mainContent');

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
      if (state.ws) { try { state.ws.close(); } catch (_) {} state.ws = null; }
      if (state.term) { try { state.term.dispose(); } catch (_) {} state.term = null; }
      mainContentEl.className = 'empty-state';
      mainContentEl.innerHTML = `
        <div class="empty-state-card">
          <h2 class="empty-state-title">왼쪽에서 세션을 선택하거나 새로 만드세요</h2>
          <p class="empty-state-body">
            터미널에서 <code>sgtmux</code> 명령으로 새 tmux 세션을 시작할 수 있습니다.
          </p>
        </div>`;
    }
    await fetchSessions();
  } catch (e) {
    alert('요청 실패: ' + e.message);
  }
}

function ensureTerminalView() {
  if (mainContentEl.classList.contains('empty-state')) {
    mainContentEl.classList.remove('empty-state');
    mainContentEl.className = 'terminal-shell';
    mainContentEl.innerHTML = `
      <div class="terminal-card">
        <div id="terminal"></div>
      </div>
    `;
  }
}

function selectSession(name) {
  if (state.current === name) return;
  state.current = name;
  currentEl.textContent = name;
  killBtn.hidden = false;

  // close existing
  if (state.ws) { try { state.ws.close(); } catch (_) {} state.ws = null; }
  if (state.term) { try { state.term.dispose(); } catch (_) {} state.term = null; }

  ensureTerminalView();

  // create xterm
  state.term = new Terminal({
    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
    fontSize: 13,
    theme: {
      background: '#15161a',   // surface-recessed (matches CSS)
      foreground: '#f0f0f3',   // ink (off-white)
      cursor: '#f0f0f3',
      selectionBackground: 'rgba(240, 240, 243, 0.18)',
    },
    cursorBlink: true,
    scrollback: 10000,
  });
  state.fitAddon = new FitAddon.FitAddon();
  state.term.loadAddon(state.fitAddon);
  state.term.open(document.getElementById('terminal'));
  state.fitAddon.fit();

  // connect WS
  const { cols, rows } = state.term;
  const wsUrl = `ws://${location.host}/ws?session=${encodeURIComponent(name)}&cols=${cols}&rows=${rows}`;
  state.ws = new WebSocket(wsUrl);
  state.ws.binaryType = 'arraybuffer';

  state.ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') state.term.write(ev.data);
    else state.term.write(new Uint8Array(ev.data));
  };
  state.ws.onclose = () => { state.term.writeln('\r\n\x1b[2m[sgtmux] connection closed.\x1b[0m'); };

  state.term.onData((d) => {
    if (state.ws && state.ws.readyState === 1) state.ws.send(d);
  });

  // refresh styles
  document.querySelectorAll('.session-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.name === name);
  });
}

window.addEventListener('resize', () => {
  if (!state.fitAddon || !state.term || !state.ws) return;
  state.fitAddon.fit();
  const { cols, rows } = state.term;
  if (state.ws.readyState === 1) {
    state.ws.send(JSON.stringify({ resize: [cols, rows] }));
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

// boot
fetchSessions();
setInterval(fetchSessions, POLL_MS);
