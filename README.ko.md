# 🔔 tmuxbell

> 🌐 [English](README.md) · **한국어** · [中文](README.zh.md)

서버 한 대(또는 docker container 한 개) 안에서 도는 tmux 세션들을 깔끔한 웹
대시보드로 모아 보고 조작하는 도구. 각 세션의 활동 상태가 실시간으로 표시되어,
여러 Claude·셸 세션을 병렬로 돌리면서 어디가 응답 중이고 어디가 막 끝났는지
한눈에 파악할 수 있습니다.

- `tmuxbell` 한 줄로 새 tmux 세션 + 웹 대시보드를 동시에 띄움
- 세션 목록 사이드바, 각 세션의 활동 상태 색 (응답 대기 = 녹색, 작업 중 = 분홍)
- xterm.js로 터미널 그대로 표시 → tmux pane split / 키바인드 / Claude TUI 전부 정상 동작
- 백엔드는 `tmux attach -t NAME`을 `node-pty`로 띄워 WebSocket으로 중계 (ttyd 불필요)

## 요구사항

- Linux
- Node.js 18+
- tmux 3.0+

## 설치

```bash
cd ~/tmuxbell/server
npm install
chmod +x ~/tmuxbell/bin/tmuxbell
# PATH에 ~/tmuxbell/bin 추가 (또는 심볼릭 링크)
ln -sf ~/tmuxbell/bin/tmuxbell /usr/local/bin/tmuxbell
```

## 사용

```bash
tmuxbell              # 자동 이름 세션 + claude 실행, 대시보드 자동 기동
tmuxbell work         # "work" 세션 attach 또는 생성 후 claude
tmuxbell dev -- bash  # "dev" 세션에서 bash 실행
tmuxbell --list       # 세션 목록 + 대시보드 URL 출력
```

브라우저: <http://localhost:7681>

### 기본 명령

`tmuxbell NAME`을 `-- CMD` 없이 호출하면 새 세션이 자동으로
[Claude Code](https://github.com/anthropics/claude-code)(`claude`)를
실행합니다. 전역 기본값을 바꾸려면 `TMUXBELL_DEFAULT_CMD` 환경변수,
일회성으로만 바꾸려면 `-- CMD`를 사용하세요.

## 환경변수

| 이름 | 기본값 | 설명 |
|---|---|---|
| `TMUXBELL_DIR` | `~/tmuxbell` | 설치 경로 |
| `TMUXBELL_PORT` | `7681` | 대시보드 포트 |
| `TMUXBELL_DEFAULT_CMD` | `claude` | 새 세션에서 자동 실행할 명령 |

## 활동 상태 표시 규칙

- 🟢 idle (green): pty 출력이 1.5s 이상 멎음 → Claude 응답 끝났다고 추정
- 🟣 active (magenta): 연속적으로 출력이 진행 중
- ⚪ unknown (gray): 아직 한 번도 관측 안 된 세션

단발 출력(예: tmux의 15초 status bar 갱신, shell prompt 리드로우)은
활동으로 잡지 않습니다. 진짜 스트리밍은 짧은 간격의 이벤트가 연속되므로
계속 active로 유지됩니다.

## 개발

```bash
cd server
TMUXBELL_PORT=7681 node server.js
# 브라우저 http://localhost:7681
```

## Built on

tmuxbell은 다음 오픈소스 프로젝트들의 훌륭한 작업 위에 만들어졌습니다.

- [tmux](https://github.com/tmux/tmux) — terminal multiplexing
- [xterm.js](https://github.com/xtermjs/xterm.js) — browser terminal
- [node-pty](https://github.com/microsoft/node-pty) — PTY in Node
- [express](https://github.com/expressjs/express), [ws](https://github.com/websockets/ws) — HTTP + WebSocket
- [Pretendard](https://github.com/orioncactus/pretendard), [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) — typography
- [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) — design tokens

전체 라이선스·저작권 표기는 [`CREDITS.md`](./CREDITS.md).

## 라이선스

MIT. 전체 라이선스 텍스트는 [`LICENSE`](./LICENSE).
