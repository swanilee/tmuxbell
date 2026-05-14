# 🔔 tmuxbell

> 🌐 [English](README.md) · **한국어** · [中文](README.zh.md)

![tmuxbell dashboard](docs/landing.png)

저는 여러 작업을 병렬로 돌리는 방식을 선호합니다. Claude 세션, 학습
스크립트, 테스트 watcher, 빌드를 함께 띄워두고 작업하다 보면, 어느
작업이 끝났는지 확인하려고 다른 세션을 종종 들여다보게 됩니다. 그러다
보면 정작 집중하고 있던 작업의 흐름이 자주 끊겼습니다.

**tmuxbell**은 세션의 출력이 멈추는 순간을 감지해 알려주는 작은 웹
대시보드입니다. 세션이 출력하는 동안에는 사이드바 항목이 분홍색으로
표시되고, 멈추는 즉시 녹색으로 전환됩니다. 아직 확인하지 않은 세션에는
✓ 표시가 함께 떠 있어, 진행 중인 작업을 계속하다가 체크가 보이는
것만 확인하면 됩니다. **비슷한 답답함을 느끼셨다면, 흐름을 잃지 않고
편하게, 효율적으로 작업해 보세요.**

터미널에 출력을 만들어내는 작업이라면 무엇이든 동작합니다 — Claude
Code, `python train.py`, `pytest --watch`, `cargo build` 같은 명령
모두 같은 방식으로 추적됩니다.

- `tmuxbell` 한 줄로 새 tmux 세션 + 웹 대시보드를 동시에 띄움
- 세션 목록 사이드바, 각 세션의 활동 상태 색 (응답 대기 = 녹색, 작업 중 = 분홍)
- ✓ 체크 — 세션이 끝나면 표시되고, 들어가서 보면 자동으로 사라짐
- xterm.js로 터미널 그대로 표시 → tmux pane split / 키바인드 / Claude TUI 전부 정상 동작
- 백엔드는 `tmux attach -t NAME`을 `node-pty`로 띄워 WebSocket으로 중계

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
