import type { MouseEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { PtySessionSummary, ServerEvent } from '@pty-terminal/shared';
import { closeSession, createSession, getSnapshot, listSessions, resizeSession, updateSessionAlias, writeToSession, wsUrl } from './api.js';
import { defaultFontFamily, loadTerminalSettings, normalizeTerminalSettings, saveTerminalSettings, type TerminalSettings } from './settings.js';
import { getTerminalTheme, terminalThemes } from './terminalThemes.js';
import './style.css';

export function App() {
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const [sessions, setSessions] = useState<PtySessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [terminalFocused, setTerminalFocused] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<TerminalSettings>(() => loadTerminalSettings());
  const [editingAliasId, setEditingAliasId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; session: PtySessionSummary } | null>(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  function reportError(cause: unknown, options: { writeToTerminal?: boolean } = {}) {
    const message = cause instanceof Error ? cause.message : String(cause);
    setError(message);

    if (options.writeToTerminal ?? true) {
      terminalRef.current?.write(`\r\n\x1b[31m${stripControlCharacters(message)}\x1b[0m\r\n`);
    }
  }

  const refreshSessions = useCallback(async () => {
    const nextSessions = await listSessions();
    setSessions(nextSessions);
    setActiveSessionId((current) => current ?? nextSessions[0]?.id ?? null);
  }, []);

  useEffect(() => {
    if (!error) {
      return;
    }

    const timeout = window.setTimeout(() => setError(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [error]);

  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: normalizeTerminalSettings(settings).fontFamily,
      fontSize: settings.fontSize,
      theme: getTerminalTheme(settings.themeId).theme,
    });
    const fit = new FitAddon();

    const fitAndResize = () => {
      fit.fit();
      const sessionId = activeSessionRef.current;
      if (sessionId && terminal.cols > 0 && terminal.rows > 0) {
        void resizeSession(sessionId, terminal.cols, terminal.rows).catch((cause) => reportError(cause));
      }
    };

    terminal.loadAddon(fit);
    terminal.open(terminalHostRef.current!);
    fitAndResize();
    terminal.focus();

    const terminalHost = terminalHostRef.current!;
    const handleFocusIn = () => setTerminalFocused(true);
    const handleFocusOut = () => setTerminalFocused(false);
    terminalHost.addEventListener('focusin', handleFocusIn);
    terminalHost.addEventListener('focusout', handleFocusOut);

    terminal.onData((data) => {
      const sessionId = activeSessionRef.current;
      if (sessionId) {
        void writeToSession(sessionId, data).catch((cause) => reportError(cause));
      }
    });

    const handleSelectionMouseUp = () => {
      if (terminal.hasSelection()) {
        const text = terminal.getSelection();
        if (text) {
          navigator.clipboard.writeText(text).catch(() => {});
        }
      }
    };
    terminalHost.addEventListener('mouseup', handleSelectionMouseUp);

    terminalRef.current = terminal;
    fitRef.current = fit;

    const resizeObserver = new ResizeObserver(() => fitAndResize());
    resizeObserver.observe(terminalHostRef.current!);

    return () => {
      resizeObserver.disconnect();
      terminalHost.removeEventListener('focusin', handleFocusIn);
      terminalHost.removeEventListener('focusout', handleFocusOut);
      terminalHost.removeEventListener('mouseup', handleSelectionMouseUp);
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, []);

  useEffect(() => {
    void document.fonts.load(`13px MapleMonoNFLocal`).then(() => {
      const terminal = terminalRef.current;
      if (!terminal) {
        return;
      }

      terminal.options.fontFamily = normalizeTerminalSettings(settings).fontFamily;
      terminal.refresh(0, terminal.rows - 1);
      fitRef.current?.fit();
    });
  }, [settings]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    const nextSettings = normalizeTerminalSettings(settings);
    terminal.options.fontFamily = nextSettings.fontFamily;
    terminal.options.fontSize = nextSettings.fontSize;
    terminal.options.theme = getTerminalTheme(nextSettings.themeId).theme;
    saveTerminalSettings(nextSettings);
    fitRef.current?.fit();

    const sessionId = activeSessionRef.current;
    if (sessionId && terminal.cols > 0 && terminal.rows > 0) {
      void resizeSession(sessionId, terminal.cols, terminal.rows).catch((cause) => reportError(cause));
    }
  }, [settings]);

  useEffect(() => {
    activeSessionRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    void refreshSessions().catch((cause) => reportError(cause, { writeToTerminal: false }));
  }, [refreshSessions]);

  useEffect(() => {
    let destroyed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let ws: WebSocket | null = null;
    let attempt = 0;

    function connect() {
      if (destroyed) {
        return;
      }

      ws = new WebSocket(wsUrl());

      ws.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data as string) as ServerEvent;
          if (event.type === 'session_created') {
            setSessions((current) => [event.session, ...current.filter((s) => s.id !== event.session.id)]);
            setActiveSessionId((current) => current ?? event.session.id);
            return;
          }

          if (event.type === 'session_updated') {
            setSessions((current) => current.map((s) => (s.id === event.session.id ? event.session : s)));
            return;
          }

          if (event.type === 'session_output' && event.sessionId === activeSessionRef.current) {
            terminalRef.current?.write(event.chunk);
            return;
          }

          if (event.type !== 'session_output') {
            void refreshSessions().catch((cause) => reportError(cause, { writeToTerminal: false }));
          }
        } catch {
          /* malformed message, ignore */
        }
      };

      ws.onclose = () => {
        if (destroyed) {
          return;
        }

        ws = null;
        const delay = Math.min(1000 * (1 << attempt), 30_000);
        attempt++;
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        /* onclose will follow */
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }

      ws?.close();
    };
  }, [refreshSessions]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !activeSessionId) {
      terminal?.clear();
      return;
    }

    terminal.clear();
    void getSnapshot(activeSessionId)
      .then((snapshot) => {
        terminal.write(snapshot.rawOutput);
        fitRef.current?.fit();
        if (terminal.cols > 0 && terminal.rows > 0) {
          void resizeSession(activeSessionId, terminal.cols, terminal.rows).catch((cause) => reportError(cause));
        }
        terminal.focus();
      })
      .catch((cause) => reportError(cause));
  }, [activeSessionId]);

  async function handleCreate() {
    try {
      setError(null);
      const result = await createSession();
      setSessions((current) => [result.session, ...current.filter((session) => session.id !== result.session.id)]);
      setActiveSessionId(result.session.id);
    } catch (cause) {
      reportError(cause);
    }
  }

  async function handleClose(sessionId: string) {
    try {
      setError(null);
      await closeSession(sessionId);
      setSessions((current) => current.filter((session) => session.id !== sessionId));
      setActiveSessionId((current) => (current === sessionId ? null : current));
    } catch (cause) {
      reportError(cause);
    }
  }

  async function copySessionId(event: MouseEvent<HTMLButtonElement>, sessionId: string) {
    event.stopPropagation();

    try {
      await navigator.clipboard.writeText(sessionId);
      setError(`已复制 session id: ${sessionId}`);
    } catch {
      reportError('复制 session id 失败', { writeToTerminal: false });
    }
  }

  async function handleRename(sessionId: string, rawValue: string) {
    try {
      const alias = rawValue.trim() || undefined;
      const session = await updateSessionAlias(sessionId, alias);
      setSessions((current) => current.map((item) => (item.id === session.id ? session : item)));
    } catch (cause) {
      reportError(cause, { writeToTerminal: false });
    }
  }

  function openContextMenu(event: MouseEvent, session: PtySessionSummary) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY, session });
  }

  function closeContextMenu() {
    setContextMenu(null);
  }

  async function copyToClipboard(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setError(`已复制 ${label}`);
      setContextMenu(null);
    } catch {
      reportError(`复制 ${label} 失败`, { writeToTerminal: false });
    }
  }

  function updateSettings(nextSettings: TerminalSettings) {
    setSettings(normalizeTerminalSettings(nextSettings));
  }

  return (
    <main className="app">
      <aside className="sidebar">
        <div className="sidebarHeader">
          <h1>PTY Sessions</h1>
          <button onClick={() => void handleCreate()}>新建</button>
        </div>
        <div className="sessionList">
          {sessions.map((session) => (
            <div
              className={session.id === activeSessionId ? 'session active' : 'session'}
              key={session.id}
              onClick={() => setActiveSessionId(session.id)}
              onContextMenu={(event) => openContextMenu(event as unknown as MouseEvent, session)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  setActiveSessionId(session.id);
                }
              }}
            >
              {editingAliasId === session.id ? (
                <input
                  className="sessionRenameInput"
                  defaultValue={session.alias ?? ''}
                  placeholder={session.command}
                  autoFocus
                  maxLength={80}
                  onBlur={(e) => {
                    setEditingAliasId(null);
                    void handleRename(session.id, e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      (e.target as HTMLInputElement).blur();
                    }
                    if (e.key === 'Escape') {
                      setEditingAliasId(null);
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="sessionTitle" onDoubleClick={() => setEditingAliasId(session.id)}>
                  {session.alias || session.command}
                </span>
              )}
              {session.alias ? <span className="sessionCommand">{session.command}</span> : null}
              <span className="sessionMeta">
                {session.status} ·{' '}
                <button className="sessionIdButton" title="复制完整 session id" onClick={(event) => void copySessionId(event, session.id)}>
                  {session.id.slice(0, 8)}
                </button>
              </span>
            </div>
          ))}
        </div>
        <button className="settingsButton" onClick={() => setSettingsOpen(true)}>设置</button>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div>
            <strong>{activeSession ? activeSession.alias || activeSession.command : '未选择会话'}</strong>
            {activeSession ? <span>{activeSession.command} · {activeSession.cwd}</span> : null}
          </div>
          {activeSession ? <button className="dangerButton" onClick={() => void handleClose(activeSession.id)}>停止</button> : null}
        </header>
        <div
          ref={terminalHostRef}
          className={terminalFocused ? 'terminal focused' : 'terminal'}
          onMouseDown={() => terminalRef.current?.focus()}
        />
        {activeSession ? (
          <div className="inputHint">网页终端已连接当前会话。密码、验证码等敏感输入请直接在这里键入，不会经过 agent。</div>
        ) : null}
      </section>
      {error ? <div className="error">{error}</div> : null}
      {contextMenu ? (
        <>
          <div className="contextMenuBackdrop" onClick={closeContextMenu} onContextMenu={(e) => { e.preventDefault(); closeContextMenu(); }} />
          <div className="contextMenu" style={{ left: contextMenu.x, top: contextMenu.y }}>
            <button className="contextMenuItem" onClick={() => void copyToClipboard(contextMenu.session.id, 'session id')}>复制 Session ID</button>
            <button className="contextMenuItem" onClick={() => void copyToClipboard(contextMenu.session.command, 'command')}>复制 Command</button>
          </div>
        </>
      ) : null}
      {settingsOpen ? (
        <div className="settingsOverlay" onMouseDown={() => setSettingsOpen(false)}>
          <section className="settingsPanel" onMouseDown={(event) => event.stopPropagation()}>
            <header className="settingsHeader">
              <div>
                <strong>终端设置</strong>
                <span>字体、字号和主题会自动保存到本机浏览器。</span>
              </div>
              <button className="secondaryButton" onClick={() => setSettingsOpen(false)}>关闭</button>
            </header>

            <label className="settingField">
              <span>字体</span>
              <input
                value={settings.fontFamily}
                onChange={(event) => updateSettings({ ...settings, fontFamily: event.target.value })}
                placeholder={defaultFontFamily}
              />
            </label>
            <button className="secondaryButton fullWidth" onClick={() => updateSettings({ ...settings, fontFamily: defaultFontFamily })}>
              使用 Maple Mono Nerd 字体栈
            </button>
            <div className="nerdPreview" style={{ fontFamily: settings.fontFamily, fontSize: settings.fontSize }}>
              <span>图标预览</span>
              <strong>                </strong>
            </div>

            <label className="settingField">
              <span>字号</span>
              <input
                min="9"
                max="28"
                type="number"
                value={settings.fontSize}
                onChange={(event) => updateSettings({ ...settings, fontSize: Number(event.target.value) })}
              />
            </label>

            <label className="settingField">
              <span>主题配色</span>
              <select
                value={settings.themeId}
                onChange={(event) => updateSettings({ ...settings, themeId: event.target.value })}
              >
                {terminalThemes.map((theme) => (
                  <option key={theme.id} value={theme.id}>{theme.name}</option>
                ))}
              </select>
            </label>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function stripControlCharacters(value: string): string {
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}
