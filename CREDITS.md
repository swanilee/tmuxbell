# Credits / Third-Party Notices

`tmuxbell`는 다음 오픈소스 프로젝트들의 훌륭한 작업 위에 만들어졌습니다.
모든 라이선스는 permissive 계열(MIT / ISC / SIL OFL-1.1)이며 본 프로젝트의
MIT 라이선스와 호환됩니다. 각 라이선스가 요구하는 원 저작권 표기를 아래에
그대로 보존합니다.

## Runtime dependencies (Node, npm-installed)

| Package | Version | Repo | License |
|---|---|---|---|
| express | ^4.21.2 | https://github.com/expressjs/express | MIT |
| ws | ^8.18.0 | https://github.com/websockets/ws | MIT |
| node-pty | ^1.0.0 | https://github.com/microsoft/node-pty | MIT |

### express
```
(The MIT License)
Copyright (c) 2009-2014 TJ Holowaychuk <tj@vision-media.ca>
Copyright (c) 2013-2014 Roman Shtylman <shtylman+expressjs@gmail.com>
Copyright (c) 2014-2015 Douglas Christopher Wilson <doug@somethingdoug.com>
```

### ws
```
Copyright (c) 2011 Einar Otto Stangvik <einaros@gmail.com>
Copyright (c) 2013 Arnout Kazemier and contributors
Copyright (c) 2016 Luigi Pinca and contributors
```

### node-pty
```
Copyright (c) 2012-2015, Christopher Jeffrey (https://github.com/chjj/)
Copyright (c) 2016, Daniel Imms (http://www.growingwiththeweb.com)
Copyright (c) 2018-present, Microsoft Corporation
```

## Frontend (loaded via CDN)

| Asset | Source | License |
|---|---|---|
| xterm.js 5.5.0 | https://github.com/xtermjs/xterm.js (jsdelivr) | MIT |
| @xterm/addon-fit 0.10.0 | https://github.com/xtermjs/xterm.js (jsdelivr) | MIT |
| Pretendard Variable | https://github.com/orioncactus/pretendard (jsdelivr) | SIL OFL 1.1 |
| JetBrains Mono | https://github.com/JetBrains/JetBrainsMono (Google Fonts) | SIL OFL 1.1 |

### xterm.js
```
Copyright (c) 2017-2019, The xterm.js authors (https://github.com/xtermjs/xterm.js)
Copyright (c) 2014-2016, SourceLair Private Company (https://www.sourcelair.com)
Copyright (c) 2012-2013, Christopher Jeffrey (https://github.com/chjj/)
```

### Pretendard
SIL Open Font License 1.1. Copyright Kil Hyung-jin and others
(includes Adobe Source family, Inter Project Authors, and the M+ FONTS Project
Authors as embedded contributors).

### JetBrains Mono
SIL Open Font License 1.1. Copyright The JetBrains Mono Project Authors.

## External tool (not bundled, shelled out at runtime)

| Tool | Repo | License |
|---|---|---|
| tmux | https://github.com/tmux/tmux | ISC |

Used only as a child process (`tmux attach`, `tmux list-sessions`, etc.). Not
redistributed as part of tmuxbell.

## Design tokens

The visual style (color tokens, spacing scale, pill button shape, pastel
color-block sections) is adapted from the Figma marketing-site design system
documented in:

- https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/figma/DESIGN.md
- License: MIT, Copyright (c) 2026 VoltAgent

Token names and the design vocabulary were transcribed; the original art and
the figmaSans/figmaMono typefaces are NOT bundled (we substitute Pretendard
and JetBrains Mono respectively).

## Logo

The 🔔 brand mark is the standard Unicode "BELL" character (U+1F514). No
proprietary artwork is bundled.
