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
  sessionListEl.innerHTML = '';
  if (list.length === 0) {
    const li = document.createElement('li');
    li.className = 'session-meta';
    li.style.padding = 'var(--s-sm) var(--s-md)';
    li.textContent = '(세션 없음)';
    sessionListEl.appendChild(li);
    return;
  }
  for (const s of list) {
    const li = document.createElement('li');
    li.className = 'session-item' + (s.name === state.current ? ' selected' : '');
    li.dataset.name = s.name;

    const dot = document.createElement('div');
    dot.className = `session-dot ${s.status}`;
    dot.title = s.status;
    li.appendChild(dot);

    const name = document.createElement('div');
    name.className = 'session-name';
    name.textContent = s.name;
    li.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'session-meta';
    if (s.attached) meta.textContent = '●';
    li.appendChild(meta);

    li.addEventListener('click', () => selectSession(s.name));
    sessionListEl.appendChild(li);
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

killBtn.addEventListener('click', async () => {
  if (!state.current) return;
  if (!confirm(`세션 "${state.current}"를 종료할까요?`)) return;
  try {
    await fetch(`/api/sessions/${encodeURIComponent(state.current)}/kill`, { method: 'POST' });
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
    await fetchSessions();
  } catch (e) {
    alert('종료 실패: ' + e.message);
  }
});

// boot
fetchSessions();
setInterval(fetchSessions, POLL_MS);
