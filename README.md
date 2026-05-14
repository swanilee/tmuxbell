# 🔔 tmuxbell

> 🌐 **English** · [한국어](README.ko.md) · [中文](README.zh.md)

![tmuxbell dashboard](docs/landing.png)

A clean web dashboard for tmux sessions running on a single server (or
docker container). Each session shows a live activity light so you can
juggle many parallel Claude / shell sessions and instantly see which
one is responding and which one just finished.

- `tmuxbell` in one line launches both a new tmux session and the web dashboard
- Sidebar lists every session; per-session color shows status (idle = green, working = pink)
- Real `xterm.js` terminal → tmux pane splits / keybindings / Claude TUI all work
- Backend pipes `tmux attach -t NAME` through `node-pty` over a WebSocket (no ttyd required)

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
