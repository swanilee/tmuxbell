// sgtmux dashboard server.
//
// - GET  /api/sessions                          → list tmux sessions + activity
// - POST /api/sessions/:name/new                → create a new session
// - POST /api/sessions/:name/kill               → kill a session
// - GET  /api/sessions/:name/windows            → list windows of a session
// - POST /api/sessions/:name/windows            → create a window in a session
//                                                 body: { fork?: bool, name?, cmd? }
// - POST /api/sessions/:name/windows/:idx/kill  → kill a single window
// - WS   /ws?session=NAME&window=IDX            → pty stream pinned to that window
//
// Multi-window viewing:
//   - Each (parent session, window idx) pair gets a "linked view session" via
//     `tmux new-session -t parent -s _sgview_<parent>_<idx>`. Linked sessions
//     share windows with parent but maintain an independent active-window
//     pointer, so multiple WS clients can show different windows side by side.
//     The `_sgview_...` sessions are hidden from /api/sessions.

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
const VIEW_PREFIX = '_sgview_';
const IDLE_THRESHOLD_MS = 1500;
// Burst detection: when a fresh tmux attach (monitor or WS client) happens,
// tmux dumps a screen redraw. Output during that burst doesn't count as
// "Claude is responding". Burst ends when 500ms of quiet passes OR 3s cap.
const BURST_QUIET_MS = 500;
const BURST_MAX_MS = 3000;
// Suppress output for this long after a keystroke — terminal echo of what
// the user just typed is not Claude's output.
const ECHO_SUPPRESS_MS = 250;

const sessions = new Map();
function trackSession(name) {
  if (!sessions.has(name)) {
    sessions.set(name, {
      lastOutputMs: 0,
      lastUserInputMs: 0,
      ptys: new Set(),       // WS-driven view ptys
      monitorPty: null,      // background read-only attach
      bellAt: 0,
      burstActive: false,
      burstQuietTimer: null,
      burstMaxTimer: null,
      // completion-acknowledgement tracking
      prevStatus: 'unknown',
      completedAt: 0,        // last active → idle transition
      acknowledgedAt: 0,     // last WS connect or explicit ack
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

// Spawn a background read-only tmux attach for a session, so we can track
// pane output even when no UI client is connected. The monitor stays alive
// across WS client come/go.
function ensureMonitor(name) {
  const state = trackSession(name);
  if (state.monitorPty) return;
  let mon;
  try {
    mon = pty.spawn(TMUX, ['attach', '-t', name, '-r'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: process.env.HOME,
      env: process.env,
    });
  } catch (e) {
    console.error(`[sgtmux] failed to spawn monitor for ${name}:`, e.message);
    return;
  }
  state.monitorPty = mon;
  startBurst(state);

  mon.onData(data => {
    const now = Date.now();
    if (state.burstActive) {
      if (state.burstQuietTimer) clearTimeout(state.burstQuietTimer);
      state.burstQuietTimer = setTimeout(() => endBurst(state), BURST_QUIET_MS);
      return;
    }
    // Recent user input → this is shell echo of what they typed, not Claude
    if (now - state.lastUserInputMs < ECHO_SUPPRESS_MS) return;
    state.lastOutputMs = now;
    if (data.includes('\x07')) state.bellAt = now;
  });

  mon.onExit(() => {
    state.monitorPty = null;
    endBurst(state);
  });
}

function cleanupMonitors(currentNames) {
  for (const [name, state] of sessions.entries()) {
    if (!currentNames.has(name) && state.monitorPty) {
      try { state.monitorPty.kill(); } catch (_) {}
      state.monitorPty = null;
    }
  }
}

// ── Multi-window viewing helpers ──────────────────────────────────────────
function viewSessionName(parent, windowIdx) {
  return `${VIEW_PREFIX}${parent}__${windowIdx}`;
}

function sessionExists(name) {
  try {
    execSync(`${TMUX} has-session -t ${JSON.stringify(name)}`, { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

function ensureViewSession(parent, windowIdx) {
  const view = viewSessionName(parent, windowIdx);
  if (!sessionExists(view)) {
    // -t parent links into parent's session group, sharing all windows
    execSync(`${TMUX} new-session -d -t ${JSON.stringify(parent)} -s ${JSON.stringify(view)}`, { stdio: 'ignore' });
    // keep alive even when no clients
    try {
      execSync(`${TMUX} set-option -t ${JSON.stringify(view)} destroy-unattached off`, { stdio: 'ignore' });
    } catch (_) {}
  }
  // pin the view's active window to the requested idx (per-client state)
  try {
    execSync(`${TMUX} select-window -t ${JSON.stringify(view + ':' + windowIdx)}`, { stdio: 'ignore' });
  } catch (_) {}
  return view;
}

function listWindows(name) {
  try {
    const out = execSync(
      `${TMUX} list-windows -t ${JSON.stringify(name)} -F '#{window_index}|#{window_name}|#{window_active}|#{pane_current_path}'`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    if (!out) return [];
    return out.split('\n').map(line => {
      const [idx, wname, active, cwd] = line.split('|');
      return {
        index: parseInt(idx, 10),
        name: wname,
        active: active === '1',
        cwd: cwd || null,
      };
    });
  } catch (e) {
    return [];
  }
}

function isValidName(s) {
  return typeof s === 'string' && /^[A-Za-z0-9_-]+$/.test(s);
}

function tmuxList() {
  let out;
  try {
    out = execSync(
      `${TMUX} list-sessions -F '#{session_name}|#{session_created}|#{session_attached}|#{session_activity}'`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
  } catch (e) {
    cleanupMonitors(new Set());
    return [];
  }
  if (!out) {
    cleanupMonitors(new Set());
    return [];
  }
  const now = Date.now();
  const names = new Set();
  const parsed = out.split('\n')
    .filter(line => {
      const n = line.split('|')[0];
      return n && !n.startsWith(VIEW_PREFIX);
    })
    .map(line => {
    const [name, created, attached, activity] = line.split('|');
    names.add(name);
    // Make sure every visible session has a monitor so we keep tracking
    // output even without an open WS view.
    ensureMonitor(name);
    const state = sessions.get(name);
    const lastOutputMs = state ? state.lastOutputMs : 0;
    const idleMs = lastOutputMs ? now - lastOutputMs : null;
    let status = 'unknown';
    if (lastOutputMs > 0) {
      status = idleMs > IDLE_THRESHOLD_MS ? 'idle' : 'active';
    }
    // Detect active → idle transition = "Claude just finished responding"
    if (state && state.prevStatus === 'active' && status === 'idle') {
      state.completedAt = now;
      // Auto-ack if someone is currently viewing this session via WS
      if (state.ptys.size > 0) state.acknowledgedAt = now;
    }
    if (state) state.prevStatus = status;
    const hasUnseenCompletion =
      state && state.completedAt > state.acknowledgedAt;
    return {
      name,
      created: parseInt(created, 10) * 1000,
      attached: attached === '1',
      lastActivityTmux: parseInt(activity, 10) * 1000,
      lastOutputMs,
      idleMs,
      status,
      hasUnseenCompletion: !!hasUnseenCompletion,
    };
  });
  cleanupMonitors(names);
  return parsed;
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
  if (!isValidName(name)) {
    return res.status(400).json({ ok: false, error: 'invalid session name' });
  }
  try {
    // Also kill any linked view sessions for this parent
    try {
      const all = execSync(`${TMUX} list-sessions -F '#{session_name}'`, { encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim().split('\n');
      for (const n of all) {
        if (n.startsWith(`${VIEW_PREFIX}${name}__`)) {
          try { execSync(`${TMUX} kill-session -t ${JSON.stringify(n)}`, { stdio: 'ignore' }); } catch (_) {}
        }
      }
    } catch (_) {}
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

// ── Window APIs ─────────────────────────────────────────────────────────
app.get('/api/sessions/:name/windows', (req, res) => {
  if (!isValidName(req.params.name)) return res.status(400).json({ ok: false, error: 'invalid name' });
  res.json({ windows: listWindows(req.params.name) });
});

app.post('/api/sessions/:name/windows', (req, res) => {
  const name = req.params.name;
  if (!isValidName(name)) return res.status(400).json({ ok: false, error: 'invalid name' });
  const body = req.body || {};
  const fork = !!body.fork;
  const wname = (body.name && isValidName(body.name)) ? body.name : null;
  const cmd = (typeof body.cmd === 'string' && body.cmd.trim()) ? body.cmd : (process.env.SGTMUX_DEFAULT_CMD || 'claude');

  const args = ['new-window', '-d', '-t', name, '-P', '-F', '#{window_index}'];
  if (wname) { args.push('-n', wname); }
  if (fork) {
    // use current pane's working dir of the active window
    try {
      const cwd = execSync(
        `${TMUX} display-message -p -t ${JSON.stringify(name)} '#{pane_current_path}'`,
        { encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }
      ).trim();
      if (cwd) args.push('-c', cwd);
    } catch (_) {}
  }
  args.push(cmd);

  try {
    const out = execSync(
      `${TMUX} ${args.map(a => JSON.stringify(a)).join(' ')}`,
      { encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }
    ).trim();
    const newIdx = parseInt(out, 10);
    res.json({ ok: true, index: isNaN(newIdx) ? null : newIdx });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.stderr ? e.stderr.toString() : String(e) });
  }
});

app.post('/api/sessions/:name/windows/:idx/kill', (req, res) => {
  const name = req.params.name;
  const idx = parseInt(req.params.idx, 10);
  if (!isValidName(name) || isNaN(idx)) return res.status(400).json({ ok: false, error: 'invalid params' });
  try {
    execSync(`${TMUX} kill-window -t ${JSON.stringify(name + ':' + idx)}`, { stdio: 'ignore' });
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
  if (!name || !isValidName(name)) { ws.close(); return; }

  const cols = parseInt(url.searchParams.get('cols') || '120', 10);
  const rows = parseInt(url.searchParams.get('rows') || '40', 10);
  const windowParam = url.searchParams.get('window');
  const windowIdx = windowParam != null ? parseInt(windowParam, 10) : null;

  // Pick the attach target:
  //   - if window=IDX given: ensure a per-window linked view session
  //     and attach to it (its active window is pinned to IDX).
  //   - else attach directly to parent (legacy / single-panel mode).
  let attachTarget = name;
  if (windowIdx != null && !isNaN(windowIdx)) {
    attachTarget = ensureViewSession(name, windowIdx);
  }

  const term = pty.spawn(TMUX, ['attach', '-t', attachTarget], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: process.env.HOME,
    env: process.env,
  });

  const state = trackSession(name);
  state.ptys.add(term);
  // Viewing the session counts as acknowledging any pending completion notif.
  state.acknowledgedAt = Date.now();
  // The background monitor pty is the source of truth for activity.
  // This WS pty only forwards bytes to the client.
  ensureMonitor(name);
  // tmux emits a status-bar redraw to the existing monitor when a new
  // client attaches. Suppress that as a burst.
  startBurst(state);

  term.onData(data => {
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
    // User is typing — flag so the imminent echo doesn't get classified as activity
    state.lastUserInputMs = Date.now();
    term.write(s);
  });

  ws.on('close', () => {
    state.ptys.delete(term);
    try { term.kill(); } catch (_) {}
    // tmux notifies remaining clients (our monitor) when this view detaches;
    // treat that side-effect output as redraw, not activity.
    startBurst(state);
  });
});

server.listen(PORT, () => {
  console.log(`[sgtmux] listening on http://localhost:${PORT}`);
  console.log(`[sgtmux] host=${os.hostname()}`);
});
