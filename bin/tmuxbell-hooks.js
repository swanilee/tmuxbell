#!/usr/bin/env node
// Install/uninstall tmuxbell hooks in ~/.claude/settings.json.
//
// Hooks added:
//   - UserPromptSubmit  → POST /claude/start
//   - Stop              → POST /claude/stop
//
// These let the dashboard show a precise busy/idle state for sessions
// running Claude Code, including long-running tool calls that don't
// stream output (e.g. `sleep 30`).
//
// Each installed command carries a `# tmuxbell-hook-PORT` marker so
// uninstall can find and remove only ours without touching the user's
// other hooks.
//
// Usage:
//   tmuxbell-hooks.js install
//   tmuxbell-hooks.js uninstall

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SETTINGS_PATH = process.env.CLAUDE_CONFIG_DIR
  ? path.join(process.env.CLAUDE_CONFIG_DIR, 'settings.json')
  : path.join(os.homedir(), '.claude', 'settings.json');

const PORT = parseInt(process.env.TMUXBELL_PORT || '7681', 10);
const TAG = `# tmuxbell-hook-${PORT}`;

function cmdFor(event) {
  return `curl -s -X POST "http://localhost:${PORT}/api/sessions/$(tmux display-message -p '#S' 2>/dev/null)/claude/${event}" >/dev/null 2>&1 || true ${TAG}`;
}

const EVENT_COMMANDS = {
  UserPromptSubmit: cmdFor('start'),
  Stop: cmdFor('stop'),
};

function readSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) return {};
  const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`tmuxbell-hooks: cannot parse ${SETTINGS_PATH}: ${e.message}`);
    process.exit(1);
  }
}

function writeSettings(obj) {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(obj, null, 2) + '\n');
}

function isOurs(hook) {
  return hook && hook.type === 'command' && typeof hook.command === 'string'
    && hook.command.includes('tmuxbell-hook-');
}

function pruneOursIn(eventArr) {
  // eventArr is the array of "hook configs" for one event.
  // Each entry: { matcher?, hooks: [ {type, command, ...} ] }
  const out = [];
  for (const group of eventArr) {
    const remaining = (group.hooks || []).filter(h => !isOurs(h));
    if (remaining.length > 0) {
      out.push({ ...group, hooks: remaining });
    }
  }
  return out;
}

function install() {
  const s = readSettings();
  s.hooks = s.hooks || {};
  for (const [event, cmd] of Object.entries(EVENT_COMMANDS)) {
    const arr = Array.isArray(s.hooks[event]) ? s.hooks[event] : [];
    const cleaned = pruneOursIn(arr);
    cleaned.push({ hooks: [{ type: 'command', command: cmd }] });
    s.hooks[event] = cleaned;
  }
  writeSettings(s);
  console.log(`Installed tmuxbell hooks → ${SETTINGS_PATH}`);
  console.log(`  events: ${Object.keys(EVENT_COMMANDS).join(', ')}`);
  console.log(`  port:   ${PORT}`);
  console.log(`Open a new claude session for the hooks to take effect.`);
}

function uninstall() {
  const s = readSettings();
  if (!s.hooks) {
    console.log(`No hooks section in ${SETTINGS_PATH}; nothing to remove.`);
    return;
  }
  let beforeTotal = 0;
  let afterTotal = 0;
  for (const event of Object.keys(s.hooks)) {
    if (!Array.isArray(s.hooks[event])) continue;
    for (const g of s.hooks[event]) beforeTotal += (g.hooks || []).length;
    s.hooks[event] = pruneOursIn(s.hooks[event]);
    for (const g of s.hooks[event]) afterTotal += (g.hooks || []).length;
    if (s.hooks[event].length === 0) delete s.hooks[event];
  }
  if (Object.keys(s.hooks).length === 0) delete s.hooks;
  writeSettings(s);
  console.log(`Removed ${beforeTotal - afterTotal} tmuxbell hook(s) from ${SETTINGS_PATH}.`);
}

const action = process.argv[2];
if (action === 'install') install();
else if (action === 'uninstall') uninstall();
else {
  console.error('usage: tmuxbell-hooks.js install | uninstall');
  process.exit(1);
}
