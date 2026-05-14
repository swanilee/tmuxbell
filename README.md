# sgtmux

서버 한 대(또는 docker container 한 개) 안에서 도는 tmux 세션들을, Figma 풍의 깔끔한 웹 UI로 모아 보고 조작하는 도구.

- `sgtmux` 한 줄로 새 tmux 세션 + 웹 대시보드를 동시에 띄움
- 세션 목록 사이드바, 각 세션의 활동 상태 색 (응답 대기 = 녹색, 작업 중 = 분홍)
- xterm.js로 터미널 그대로 표시 → tmux pane split / 키바인드 / Claude TUI 전부 정상 동작
- 백엔드는 `tmux attach -t NAME`을 `node-pty`로 띄워 WebSocket으로 중계 (ttyd 불필요)

## 요구사항

- Linux
- Node.js 18+
- tmux 3.0+

## 설치

```bash
cd ~/sgtmux/server
npm install
chmod +x ~/sgtmux/bin/sgtmux
# PATH에 ~/sgtmux/bin 추가 (또는 심볼릭 링크)
ln -sf ~/sgtmux/bin/sgtmux /usr/local/bin/sgtmux
```

## 사용

```bash
sgtmux              # 자동 이름 세션 + claude 실행, 대시보드 자동 기동
sgtmux work         # "work" 세션 attach 또는 생성 후 claude
sgtmux dev -- bash  # "dev" 세션에서 bash 실행
sgtmux --list       # 세션 목록 + 대시보드 URL 출력
```

브라우저: <http://localhost:7681>

## 환경변수

| 이름 | 기본값 | 설명 |
|---|---|---|
| `SGTMUX_DIR` | `~/sgtmux` | 설치 경로 |
| `SGTMUX_PORT` | `7681` | 대시보드 포트 |
| `SGTMUX_DEFAULT_CMD` | `claude` | 새 세션에서 실행할 명령 |

## 활동 상태 표시 규칙 (MVP)

- 🟢 idle (green): pty 출력이 1.5s 이상 멎음 → claude 응답 끝났다고 추정
- 🟣 active (magenta): 최근 출력 진행 중
- ⚪ unknown: 한 번도 attach 안 된 세션

향후: Claude Code의 Stop 훅을 직접 받아서 더 정확하게 표시 예정.

## 개발

```bash
cd server
SGTMUX_PORT=7681 node server.js
# 브라우저 http://localhost:7681
```

## 라이선스

MIT. 전체 라이선스 텍스트는 [`LICENSE`](./LICENSE).

## 크레딧 / Third-Party

전체 의존성 + 라이선스 출처는 [`CREDITS.md`](./CREDITS.md). 요약:

- 런타임 npm: [express](https://github.com/expressjs/express), [ws](https://github.com/websockets/ws), [node-pty](https://github.com/microsoft/node-pty) — 모두 MIT
- 프론트엔드 CDN: [xterm.js + addon-fit](https://github.com/xtermjs/xterm.js) (MIT), [Pretendard](https://github.com/orioncactus/pretendard) (OFL-1.1), [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) (OFL-1.1)
- 시스템 도구: [tmux](https://github.com/tmux/tmux) (ISC) — 자식 프로세스로 호출만, 번들하지 않음
- 디자인 토큰: [VoltAgent/awesome-design-md (Figma)](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/figma/DESIGN.md) — MIT
