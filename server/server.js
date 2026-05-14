// sgtmux dashboard server.
//
// - GET  /api/sessions                            → list tmux sessions + activity
// - POST /api/sessions/:name/new                  → create a new session
// - POST /api/sessions/:name/kill                 → kill a session
// - GET  /api/sessions/:name/windows              → list windows of a session
// - POST /api/sessions/:name/windows              → add a window
//                                                   body: { fork?, name?, cmd? }
// - POST /api/sessions/:name/windows/:idx/kill    → kill a single window
// - POST /api/sessions/:name/windows/:idx/select  → switch the session's active
//                                                   window (so attached clients
//                                                   redraw to that window)
// - WS   /ws?session=NAME                         → pty stream attached to NAME's
//                                                   current active window
//
// Window UI model is a *tab strip* per session: there is exactly one attach
// per selected session and clicking a tab calls /select to switch the
// underlying tmux active window. (Earlier multi-panel attempts using tmux
// session groups proved unreliable: tmux 3.2a syncs current window across
// linked sessions when a second client attaches, so per-panel isolation was
// impossible.)

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

// ── Per-window activity tracking via capture-pane polling ────────────────
//
// Background interval captures each window's visible pane and hashes it.
// When the hash changes, that window's lastChangeMs advances. Echo from the
// active window is suppressed if user typed recently.
const windowStates = new Map();      // key: 'session::idx' → state object
const WINDOW_POLL_MS = 700;

function getWindowKey(session, idx) { return `${session}::${idx}`; }

function trackWindow(session, idx) {
  const k = getWindowKey(session, idx);
  if (!windowStates.has(k)) {
    windowStates.set(k, {
      hash: null,
      lastChangeMs: 0,
      prevStatus: 'unknown',
      completedAt: 0,
      acknowledgedAt: 0,
      burstUntil: 0,
    });
  }
  return windowStates.get(k);
}

const WINDOW_BURST_MS = 1000;
function startWindowBurst(session, idx) {
  const ws = trackWindow(session, idx);
  ws.burstUntil = Date.now() + WINDOW_BURST_MS;
}
function burstAllWindowsOf(session) {
  const allWindows = listAllWindows();
  const wins = allWindows.get(session) || [];
  for (const w of wins) startWindowBurst(session, w.index);
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

function pollWindowOnce(session, idx, isActiveWindow) {
  const state = trackWindow(session, idx);
  // Active window's activity is already tracked at the session level via the
  // monitor pty. Skip capture-pane for it AND reset its hash, so when it
  // becomes inactive later, the next poll just establishes a baseline rather
  // than reporting a (false) change.
  if (isActiveWindow) {
    state.hash = null;
    return;
  }
  let content;
  try {
    content = execSync(
      `${TMUX} capture-pane -p -t ${JSON.stringify(`${session}:${idx}`)}`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
  } catch (_) {
    return;
  }
  const h = hashString(content);
  const now = Date.now();
  // During the post-switch burst, just refresh the baseline; don't count as
  // activity. (tmux may issue redraws to a freshly-deactivated pane.)
  if (now < state.burstUntil) {
    state.hash = h;
    return;
  }
  if (state.hash !== null && state.hash !== h) {
    state.lastChangeMs = now;
  }
  state.hash = h;
}

function cleanupWindowStates(currentKeys) {
  for (const k of Array.from(windowStates.keys())) {
    if (!currentKeys.has(k)) windowStates.delete(k);
  }
}

setInterval(() => {
  const allWindows = listAllWindows();
  const seen = new Set();
  for (const [session, wins] of allWindows.entries()) {
    if (session.startsWith(VIEW_PREFIX)) continue;
    for (const w of wins) {
      seen.add(getWindowKey(session, w.index));
      pollWindowOnce(session, w.index, !!w.active);
    }
  }
  cleanupWindowStates(seen);
}, WINDOW_POLL_MS);

function sessionExists(name) {
  try {
    execSync(`${TMUX} has-session -t ${JSON.stringify(name)}`, { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
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

// On server start, clean up any leftover view sessions from older versions.
function cleanupLegacyViewSessions() {
  try {
    const out = execSync(`${TMUX} list-sessions -F '#{session_name}'`, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!out) return;
    for (const n of out.split('\n')) {
      if (n.startsWith(VIEW_PREFIX)) {
        try { execSync(`${TMUX} kill-session -t ${JSON.stringify(n)}`, { stdio: 'ignore' }); } catch (_) {}
      }
    }
  } catch (_) {}
}
cleanupLegacyViewSessions();

function listAllWindows() {
  try {
    const out = execSync(
      `${TMUX} list-windows -a -F '#{session_name}|#{window_index}|#{window_name}|#{window_active}'`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    const bySession = new Map();
    if (!out) return bySession;
    for (const line of out.split('\n')) {
      const [name, idx, wname, active] = line.split('|');
      if (!name) continue;
      if (!bySession.has(name)) bySession.set(name, []);
      bySession.get(name).push({
        index: parseInt(idx, 10),
        name: wname,
        active: active === '1',
      });
    }
    for (const arr of bySession.values()) arr.sort((a, b) => a.index - b.index);
    return bySession;
  } catch (_) {
    return new Map();
  }
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
  const allWindows = listAllWindows();
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
    // Enrich window list with per-window status + completion
    const sessionIsViewed = state && state.ptys.size > 0;
    const windowList = (allWindows.get(name) || []).map(w => {
      const ws = trackWindow(name, w.index);
      const wIdleMs = ws.lastChangeMs ? now - ws.lastChangeMs : null;
      let wStatus = 'unknown';
      if (ws.lastChangeMs > 0) {
        wStatus = wIdleMs > IDLE_THRESHOLD_MS ? 'idle' : 'active';
      }
      if (ws.prevStatus === 'active' && wStatus === 'idle') {
        ws.completedAt = now;
        // Auto-ack if user is actually looking at this window right now
        if (sessionIsViewed && w.active) ws.acknowledgedAt = now;
      }
      ws.prevStatus = wStatus;
      const wHasUnseen = ws.completedAt > ws.acknowledgedAt;
      return {
        ...w,
        status: wStatus,
        hasUnseenCompletion: !!wHasUnseen,
      };
    });
    return {
      name,
      created: parseInt(created, 10) * 1000,
      attached: attached === '1',
      lastActivityTmux: parseInt(activity, 10) * 1000,
      lastOutputMs,
      idleMs,
      status,
      hasUnseenCompletion: !!hasUnseenCompletion,
      windows: windowList,
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
    const state = sessions.get(name);
    if (state) startBurst(state);
    burstAllWindowsOf(name);
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
    const state = sessions.get(name);
    if (state) startBurst(state);
    burstAllWindowsOf(name);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.stderr ? e.stderr.toString() : String(e) });
  }
});

app.post('/api/sessions/:name/windows/:idx/select', (req, res) => {
  const name = req.params.name;
  const idx = parseInt(req.params.idx, 10);
  if (!isValidName(name) || isNaN(idx)) return res.status(400).json({ ok: false, error: 'invalid params' });
  try {
    execSync(`${TMUX} select-window -t ${JSON.stringify(name + ':' + idx)}`, { stdio: 'ignore' });
    // Session monitor pty will get a redraw burst when tmux switches windows
    // for attached clients. Absorb it so we don't false-positive "active".
    const state = sessions.get(name);
    if (state) startBurst(state);
    // tmux may also issue redraws to neighboring panes (deactivated window
    // resize, etc.). Suppress per-window activity tracking briefly for ALL
    // windows of this session so the switch itself doesn't paint anything
    // magenta.
    burstAllWindowsOf(name);
    // The user is viewing this window now → ack any unseen completion on it
    const ws = trackWindow(name, idx);
    ws.acknowledgedAt = Date.now();
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

  const term = pty.spawn(TMUX, ['attach', '-t', name], {
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
