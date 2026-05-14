# tmuxbell

서버 한 대(또는 docker container 한 개) 안에서 도는 tmux 세션들을, Figma 풍의 깔끔한 웹 UI로 모아 보고 조작하는 도구.

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

## 환경변수

| 이름 | 기본값 | 설명 |
|---|---|---|
| `TMUXBELL_DIR` | `~/tmuxbell` | 설치 경로 |
| `TMUXBELL_PORT` | `7681` | 대시보드 포트 |
| `TMUXBELL_DEFAULT_CMD` | `claude` | 새 세션에서 실행할 명령 |

## 활동 상태 표시 규칙 (MVP)

- 🟢 idle (green): pty 출력이 1.5s 이상 멎음 → claude 응답 끝났다고 추정
- 🟣 active (magenta): 최근 출력 진행 중
- ⚪ unknown: 한 번도 attach 안 된 세션

향후: Claude Code의 Stop 훅을 직접 받아서 더 정확하게 표시 예정.

## 개발

```bash
cd server
TMUXBELL_PORT=7681 node server.js
# 브라우저 http://localhost:7681
```

## Built on

tmuxbell는 다음 오픈소스 프로젝트들의 훌륭한 작업 위에 만들어졌습니다.

- [tmux](https://github.com/tmux/tmux) — terminal multiplexing
- [xterm.js](https://github.com/xtermjs/xterm.js) — browser terminal
- [node-pty](https://github.com/microsoft/node-pty) — PTY in Node
- [express](https://github.com/expressjs/express), [ws](https://github.com/websockets/ws) — HTTP + WebSocket
- [Pretendard](https://github.com/orioncactus/pretendard), [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) — typography
- [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) — design tokens

전체 라이선스·저작권 표기는 [`CREDITS.md`](./CREDITS.md).

## 라이선스

MIT. 전체 라이선스 텍스트는 [`LICENSE`](./LICENSE).
