// tmuxbell i18n.
//
// - I18N: dict per language { key → string }.
// - t(key, vars?)        — translate; substitutes {name} style placeholders.
// - currentLang()        — read localStorage, default 'en'.
// - setLang(lang)        — persist + applyI18n() + force re-render hooks.
// - applyI18n()          — sets data-i18n / placeholder / title on static DOM.

const I18N = {
  en: {
    'doc.title': 'tmuxbell',
    'sidebar.sessions': 'SESSIONS',
    'sidebar.new': '+ New session',
    'sidebar.none': '(no sessions)',
    'sidebar.mouse_wheel': 'Mouse-wheel scrollback',
    'topbar.placeholder': 'Select a session',
    'topbar.new_window': '+ New window',
    'topbar.kill_session': 'Kill session',
    'topbar.toggle_sidebar': 'Collapse / expand sidebar',
    'topbar.copy_mode': '📋 Copy',
    'topbar.copy_mode_active': '📋 Copy mode — drag to select, Ctrl+C / Esc to finish',

    'empty.title': 'Pick a session on the left or create a new one',
    'empty.body': 'Run <code>tmuxbell</code> in a terminal to start a new tmux session.<br />A <strong>green</strong> dot means waiting for input; <strong>pink</strong> means working.',

    'modal.title': 'New window',
    'modal.name_label': 'Window name (optional)',
    'modal.name_placeholder': 'e.g.: tests',
    'modal.fork_cwd': "Inherit current window's working directory (CWD)",
    'modal.cmd_label': 'Command to run in the new window (optional)',
    'modal.cmd_placeholder': 'Leave blank for claude. e.g.: bash, htop, vim foo.py',
    'modal.cmd_help': 'This command auto-runs when the new window opens. Use <code>bash</code> for a plain shell.',
    'modal.cancel': 'Cancel',
    'modal.create': 'Create',

    'tip.dblclick_rename': 'Double-click to rename',
    'tip.kill_session': 'Kill session',
    'tip.kill_window': 'Kill window',
    'tip.responding': 'Responding',
    'tip.completed_unseen': 'Response done — not yet viewed',

    'prompt.new_session_name': 'New session name:',
    'new_session.title': 'New session',
    'new_session.name_label': 'Session name',
    'new_session.name_placeholder': 'e.g.: mywork',
    'new_session.cwd_label': 'Working directory (optional)',
    'new_session.cwd_placeholder': 'e.g.: /workspaces/my-project',
    'new_session.cwd_help': "Leave blank to use the server's home directory. Must be an absolute path that exists.",
    'confirm.kill_session': 'Kill session "{name}"?',
    'confirm.kill_window': 'Kill window #{idx}?',
    'alert.invalid_name': 'Names must be alphanumeric / hyphen / underscore only.',
    'alert.create_failed': 'Create failed: {error}',
    'alert.kill_failed': 'Kill failed: {error}',
    'alert.rename_failed': 'Rename failed: {error}',
    'alert.window_kill_failed': 'Kill window failed: {error}',
    'alert.window_select_failed': 'Switch window failed: {error}',
    'alert.request_failed': 'Request failed: {error}',
    'term.disconnected': '[tmuxbell] disconnected.',
  },

  ko: {
    'doc.title': 'tmuxbell',
    'sidebar.sessions': '세션',
    'sidebar.new': '+ 새 세션',
    'sidebar.none': '(세션 없음)',
    'sidebar.mouse_wheel': '마우스 휠 스크롤백',
    'topbar.placeholder': '세션을 선택하세요',
    'topbar.new_window': '+ 새 윈도우',
    'topbar.kill_session': '세션 종료',
    'topbar.toggle_sidebar': '사이드바 접기 / 펼치기',
    'topbar.copy_mode': '📋 복사',
    'topbar.copy_mode_active': '📋 복사 모드 — 드래그로 선택, Ctrl+C / Esc로 종료',

    'empty.title': '왼쪽에서 세션을 선택하거나 새로 만드세요',
    'empty.body': '터미널에서 <code>tmuxbell</code> 명령으로 새 tmux 세션을 시작할 수 있습니다.<br />세션 점이 <strong>녹색</strong>이면 응답 대기 중, <strong>분홍</strong>이면 작업 중입니다.',

    'modal.title': '새 윈도우 추가',
    'modal.name_label': '윈도우 이름 (선택)',
    'modal.name_placeholder': '예: tests',
    'modal.fork_cwd': '현재 윈도우의 작업 디렉토리(CWD) 이어받기',
    'modal.cmd_label': '새 윈도우에서 실행할 명령 (선택)',
    'modal.cmd_placeholder': '비워두면 claude. 예: bash, htop, vim foo.py',
    'modal.cmd_help': '새 윈도우가 열리면 이 명령이 자동 실행됩니다. 그냥 셸이 필요하면 <code>bash</code>.',
    'modal.cancel': '취소',
    'modal.create': '생성',

    'tip.dblclick_rename': '더블클릭해서 이름 변경',
    'tip.kill_session': '세션 종료',
    'tip.kill_window': '윈도우 종료',
    'tip.responding': '응답 중',
    'tip.completed_unseen': '응답 완료 — 확인 안 함',

    'prompt.new_session_name': '새 세션 이름:',
    'new_session.title': '새 세션 만들기',
    'new_session.name_label': '세션 이름',
    'new_session.name_placeholder': '예: mywork',
    'new_session.cwd_label': '작업 디렉토리 (선택)',
    'new_session.cwd_placeholder': '예: /workspaces/my-project',
    'new_session.cwd_help': '비워두면 서버의 홈 디렉토리. 절대경로로 적어주세요 (존재해야 함).',
    'confirm.kill_session': '세션 "{name}"를 종료할까요?',
    'confirm.kill_window': 'window #{idx}를 종료할까요?',
    'alert.invalid_name': '이름은 영숫자/하이픈/언더스코어만 허용됩니다.',
    'alert.create_failed': '생성 실패: {error}',
    'alert.kill_failed': '종료 실패: {error}',
    'alert.rename_failed': '이름 변경 실패: {error}',
    'alert.window_kill_failed': '윈도우 종료 실패: {error}',
    'alert.window_select_failed': '윈도우 전환 실패: {error}',
    'alert.request_failed': '요청 실패: {error}',
    'term.disconnected': '[tmuxbell] 연결 끊김.',
  },

  zh: {
    'doc.title': 'tmuxbell',
    'sidebar.sessions': '会话',
    'sidebar.new': '+ 新建会话',
    'sidebar.none': '(无会话)',
    'sidebar.mouse_wheel': '鼠标滚轮滚动回溯',
    'topbar.placeholder': '请选择会话',
    'topbar.new_window': '+ 新建窗口',
    'topbar.kill_session': '关闭会话',
    'topbar.toggle_sidebar': '折叠 / 展开侧边栏',
    'topbar.copy_mode': '📋 复制',
    'topbar.copy_mode_active': '📋 复制模式 — 拖拽选择,Ctrl+C / Esc 完成',

    'empty.title': '从左侧选择一个会话或新建一个',
    'empty.body': '在终端运行 <code>tmuxbell</code> 即可启动一个新的 tmux 会话。<br /><strong>绿色</strong>圆点表示等待输入,<strong>粉色</strong>表示正在工作。',

    'modal.title': '新建窗口',
    'modal.name_label': '窗口名称(可选)',
    'modal.name_placeholder': '例如: tests',
    'modal.fork_cwd': '继承当前窗口的工作目录(CWD)',
    'modal.cmd_label': '新窗口中运行的命令(可选)',
    'modal.cmd_placeholder': '留空运行 claude。例如: bash, htop, vim foo.py',
    'modal.cmd_help': '新窗口打开时会自动运行此命令。如果只需要 shell,请输入 <code>bash</code>。',
    'modal.cancel': '取消',
    'modal.create': '创建',

    'tip.dblclick_rename': '双击重命名',
    'tip.kill_session': '关闭会话',
    'tip.kill_window': '关闭窗口',
    'tip.responding': '响应中',
    'tip.completed_unseen': '已完成 — 未查看',

    'prompt.new_session_name': '新会话名称:',
    'new_session.title': '新建会话',
    'new_session.name_label': '会话名称',
    'new_session.name_placeholder': '例如: mywork',
    'new_session.cwd_label': '工作目录(可选)',
    'new_session.cwd_placeholder': '例如: /workspaces/my-project',
    'new_session.cwd_help': '留空则使用服务器主目录。请填写存在的绝对路径。',
    'confirm.kill_session': '关闭会话 "{name}"?',
    'confirm.kill_window': '关闭窗口 #{idx}?',
    'alert.invalid_name': '名称只能包含字母、数字、连字符或下划线。',
    'alert.create_failed': '创建失败: {error}',
    'alert.kill_failed': '关闭失败: {error}',
    'alert.rename_failed': '重命名失败: {error}',
    'alert.window_kill_failed': '关闭窗口失败: {error}',
    'alert.window_select_failed': '切换窗口失败: {error}',
    'alert.request_failed': '请求失败: {error}',
    'term.disconnected': '[tmuxbell] 连接已断开。',
  },
};

const LANG_KEY = 'tmuxbellLang';
function currentLang() {
  const v = (typeof localStorage !== 'undefined') ? localStorage.getItem(LANG_KEY) : null;
  if (v && I18N[v]) return v;
  return 'en';
}

function t(key, vars) {
  const lang = currentLang();
  const dict = I18N[lang] || I18N.en;
  let s = dict[key];
  if (s == null) s = I18N.en[key] != null ? I18N.en[key] : key;
  if (vars) {
    s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : '{' + k + '}'));
  }
  return s;
}

function applyI18n() {
  document.documentElement.lang = currentLang();
  document.title = t('doc.title');
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.innerHTML = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  // refresh language-switcher button state
  document.querySelectorAll('.lang-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === currentLang());
  });
}

function setLang(lang) {
  if (!I18N[lang]) return;
  try { localStorage.setItem(LANG_KEY, lang); } catch (_) {}
  applyI18n();
  // Notify app.js to rebuild dynamic content
  window.dispatchEvent(new CustomEvent('tmuxbell:lang-changed'));
}

window.tmuxbellI18n = { t, currentLang, setLang, applyI18n };
