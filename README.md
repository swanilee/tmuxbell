# 🔔 tmuxbell

> 🌐 **English** · [한국어](README.ko.md) · [中文](README.zh.md)

![tmuxbell dashboard](docs/landing.png)

I prefer to run many things in parallel — a Claude session, a training
script, a test watcher, a build. With all of them open at once I'd
often hop over to another session just to check what had finished,
and the work I was actually focused on kept getting interrupted.

**tmuxbell** is a small web dashboard that detects the moment a
session goes quiet and shows it. While a session is producing output,
its sidebar entry stays pink; the instant the output stops, it turns
green. Any session you haven't looked at yet shows a ✓ next to it,
so you can keep working in your current window and only step over
when a check appears. **If this kind of friction sounds familiar,
give it a try — work without losing your flow, comfortably and
efficiently.**

It works with anything that prints to a terminal — Claude Code,
`python train.py`, `pytest --watch`, `cargo build`, and so on, all
tracked the same way.

- `tmuxbell` in one line launches both a new tmux session and the web dashboard
- Sidebar lists every session; per-session color shows status (idle = green, working = pink)
- ✓ check mark when a session finishes; clears automatically once you visit it
- Real `xterm.js` terminal in the browser — tmux pane splits, keybindings, and Claude TUI all work
- Backend pipes `tmux attach -t NAME` through `node-pty` over a WebSocket

## Requirements

- Linux
- Node.js 18+
- tmux 3.0+

## Install

```bash
cd ~/tmuxbell/server
npm install
chmod +x ~/tmuxbell/bin/tmuxbell
# Add ~/tmuxbell/bin to PATH or symlink:
ln -sf ~/tmuxbell/bin/tmuxbell /usr/local/bin/tmuxbell
```

## Usage

```bash
tmuxbell              # auto-named session, runs claude, dashboard auto-starts
tmuxbell work         # attach to "work" or create it, runs claude
tmuxbell dev -- bash  # "dev" session runs bash instead of claude
tmuxbell --list       # list sessions + print dashboard URL
```

Browser: <http://localhost:7681>

### Default command

If you call `tmuxbell NAME` without `-- CMD`, the new session auto-runs
[Claude Code](https://github.com/anthropics/claude-code) (`claude`) inside.
Set `TMUXBELL_DEFAULT_CMD` to change the global default, or use `-- CMD`
for a one-off override.

## Using the dashboard

**Sidebar**
- Each session row shows a status dot, the session name, and a window count.
- Click the name to focus the session; expand the row to see every window
  in that session, then click a window to jump straight to it.
- Double-click any session or window name to rename it in place
  (Enter to save, Esc to cancel).
- Hover a row to reveal the **×** button for killing that session or window.

**Main area**
- A tab strip lists every window of the current session; click a tab to
  switch the active window.
- **+ New window** — modal with optional name, optional command
  (default `claude`), and a checkbox to inherit the current window's
  working directory.
- **+ New session** — modal with optional name and an optional working
  directory (the new session runs `claude` there).

**Convenience controls**
- The chevron at the left of the topbar **collapses the sidebar** so the
  terminal can fill almost the whole window. Click again to restore.
  Collapsed state is remembered.
- **Mouse-wheel scrollback** toggle at the bottom of the sidebar — when
  on, scrolling the wheel in any pane enters tmux's copy mode and walks
  back through the pane's history. Off by default.
- **Language switcher** ([EN] / [한] / [中]) at the very bottom of the
  sidebar; the choice is remembered per browser.

## Tighter detection via Claude Code hooks (optional)

The output-based detector can miss "silent busy" moments — e.g. when
Claude is running a long `Bash` tool call like `sleep 30` that prints
nothing. If you want airtight busy/idle detection, install two tiny
hooks into `~/.claude/settings.json`:

```bash
tmuxbell --install-hooks    # adds UserPromptSubmit + Stop hooks
tmuxbell --uninstall-hooks  # removes them
```

The hooks just curl the dashboard with the current tmux session name:

- `UserPromptSubmit` → `/claude/start` (Claude is processing)
- `Stop` → `/claude/stop` (Claude is done — ✓ pops next to the session)

While these hook signals are fresh, they take priority over the
output heuristic, so the sidebar stays magenta for the whole duration
of a tool call even if no bytes hit the terminal. Existing hooks in
your config are left untouched; only the two tmuxbell entries are
added (each tagged `# tmuxbell-hook-PORT` for easy removal).

## Environment variables

| Name | Default | Description |
|---|---|---|
| `TMUXBELL_DIR` | `~/tmuxbell` | Install root |
| `TMUXBELL_PORT` | `7681` | Dashboard port |
| `TMUXBELL_DEFAULT_CMD` | `claude` | Command auto-run in a freshly-created session |

## Activity indicator rules

- 🟢 **idle** (green): no pty output for ~1.5 s → Claude probably finished responding
- 🟣 **active** (magenta): output is currently streaming (continuous, not a one-shot)
- ⚪ **unknown** (gray): a session that has never been observed yet

A single isolated output burst (tmux's 15-second status-bar tick,
shell prompt redraw, etc.) is filtered out and **not** treated as
activity. Genuine streaming has many close-spaced events and stays
marked active.

## Development

```bash
cd server
TMUXBELL_PORT=7681 node server.js
# browser http://localhost:7681
```

## Built on

tmuxbell builds on the great work of these open-source projects:

- [tmux](https://github.com/tmux/tmux) — terminal multiplexing
- [xterm.js](https://github.com/xtermjs/xterm.js) — browser terminal
- [node-pty](https://github.com/microsoft/node-pty) — PTY in Node
- [express](https://github.com/expressjs/express), [ws](https://github.com/websockets/ws) — HTTP + WebSocket
- [Pretendard](https://github.com/orioncactus/pretendard), [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) — typography
- [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) — design tokens

Full license / copyright attributions in [`CREDITS.md`](./CREDITS.md).

## License

MIT. See [`LICENSE`](./LICENSE) for the full text.
