// sgtmux dashboard server.
//
// - GET  /api/sessions             → list tmux sessions + activity state
// - POST /api/sessions/:name/new   → create a new session (body: {cmd})
// - POST /api/sessions/:name/kill  → kill a session
// - WS   /ws?session=NAME          → bidirectional pty stream attached to NAME
//
// Activity state per session:
//   - lastOutputMs: when the pty last emitted bytes
//   - lastClaudeStopMs: when a Stop signal was detected (currently inferred from
//     "idle for >= IDLE_THRESHOLD_MS" — TODO: wire Claude Code Stop hook)

const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execSync, spawn } = require('child_process');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');

const PORT = parseInt(process.env.SGTMUX_PORT || '7681', 10);
const TMUX = 'tmux';
const IDLE_THRESHOLD_MS = 1500;
// When a new WS attaches, tmux dumps a full-screen redraw. We mark the
// session "in burst" and only treat output as genuine activity once the
// burst ends. A burst ends when either:
//   - 500ms passes without any output (tmux is done repainting), OR
//   - 3 seconds have elapsed total (safety cap so real streaming can't be
//     masked indefinitely).
const BURST_QUIET_MS = 500;
const BURST_MAX_MS = 3000;

const sessions = new Map();
function trackSession(name) {
  if (!sessions.has(name)) {
    sessions.set(name, {
      lastOutputMs: 0,
      ptys: new Set(),
      bellAt: 0,
      burstActive: false,
      burstQuietTimer: null,
      burstMaxTimer: null,
    });
  }
  return sessions.get(name);
}

function endBurst(state) {
  state.burstActive = false;
  if (state.burstQuietTimer) { clearTimeout(state.burstQuietTimer); state.burstQuietTimer = null; }
  if (state.burstMaxTimer) { clearTimeout(state.burstMaxTimer); state.burstMaxTimer = null; }
}

function startBurst(state) {
  endBurst(state);
  state.burstActive = true;
  state.burstQuietTimer = setTimeout(() => endBurst(state), BURST_QUIET_MS);
  state.burstMaxTimer = setTimeout(() => endBurst(state), BURST_MAX_MS);
}

function tmuxList() {
  let out;
  try {
    out = execSync(
      `${TMUX} list-sessions -F '#{session_name}|#{session_created}|#{session_attached}|#{session_activity}'`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
  } catch (e) {
    return [];
  }
  if (!out) return [];
  const now = Date.now();
  return out.split('\n').map(line => {
    const [name, created, attached, activity] = line.split('|');
    const state = sessions.get(name);
    const lastOutputMs = state ? state.lastOutputMs : 0;
    const idleMs = lastOutputMs ? now - lastOutputMs : null;
    let status = 'unknown';
    if (lastOutputMs > 0) {
      status = idleMs > IDLE_THRESHOLD_MS ? 'idle' : 'active';
    }
    return {
      name,
      created: parseInt(created, 10) * 1000,
      attached: attached === '1',
      lastActivityTmux: parseInt(activity, 10) * 1000,
      lastOutputMs,
      idleMs,
      status,
    };
  });
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/sessions', (req, res) => {
  res.json({
    host: os.hostname(),
    sessions: tmuxList(),
  });
});

app.post('/api/sessions/:name/new', (req, res) => {
  const name = req.params.name;
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    return res.status(400).json({ ok: false, error: 'invalid session name' });
  }
  const cmd = (req.body && req.body.cmd) || process.env.SGTMUX_DEFAULT_CMD || 'claude';
  try {
    execSync(`${TMUX} new-session -d -s ${JSON.stringify(name)} ${JSON.stringify(cmd)}`, { stdio: 'ignore' });
    trackSession(name);
    res.json({ ok: true, name });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.stderr ? e.stderr.toString() : String(e) });
  }
});

app.post('/api/sessions/:name/kill', (req, res) => {
  const name = req.params.name;
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    return res.status(400).json({ ok: false, error: 'invalid session name' });
  }
  try {
    execSync(`${TMUX} kill-session -t ${JSON.stringify(name)}`, { stdio: 'ignore' });
    const st = sessions.get(name);
    if (st) {
      for (const p of st.ptys) { try { p.kill(); } catch (_) {} }
      sessions.delete(name);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.stderr ? e.stderr.toString() : String(e) });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const name = url.searchParams.get('session');
  if (!name || !/^[A-Za-z0-9_-]+$/.test(name)) { ws.close(); return; }

  const cols = parseInt(url.searchParams.get('cols') || '120', 10);
  const rows = parseInt(url.searchParams.get('rows') || '40', 10);

  const term = pty.spawn(TMUX, ['attach', '-t', name], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: process.env.HOME,
    env: process.env,
  });

  const state = trackSession(name);
  state.ptys.add(term);
  // Output that arrives between WS attach and the redraw burst settling is
  // "tmux repainting for the new client", not genuine activity. Burst is
  // active until 500ms of quiet OR 3s safety cap.
  startBurst(state);

  term.onData(data => {
    const now = Date.now();
    if (state.burstActive) {
      // still in redraw burst — extend the quiet timer, don't count as activity
      if (state.burstQuietTimer) clearTimeout(state.burstQuietTimer);
      state.burstQuietTimer = setTimeout(() => endBurst(state), BURST_QUIET_MS);
    } else {
      state.lastOutputMs = now;
    }
    if (data.includes('\x07')) state.bellAt = now;
    try { ws.send(data); } catch (_) {}
  });

  term.onExit(() => {
    state.ptys.delete(term);
    try { ws.close(); } catch (_) {}
  });

  ws.on('message', msg => {
    const s = msg.toString();
    // Control frames are JSON, terminal input is raw
    if (s.length > 2 && s.charCodeAt(0) === 0x7b /* '{' */) {
      try {
        const m = JSON.parse(s);
        if (m.resize && Array.isArray(m.resize)) {
          term.resize(m.resize[0], m.resize[1]);
          return;
        }
      } catch (_) {}
    }
    term.write(s);
  });

  ws.on('close', () => {
    state.ptys.delete(term);
    try { term.kill(); } catch (_) {}
  });
});

server.listen(PORT, () => {
  console.log(`[sgtmux] listening on http://localhost:${PORT}`);
  console.log(`[sgtmux] host=${os.hostname()}`);
});
