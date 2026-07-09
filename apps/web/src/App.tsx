import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import type { PtySessionSummary, ServerEvent } from '@pty-terminal/shared';
import { closeSession, createSession, listSessions, updateSessionAlias, wsUrl } from './api.js';
import { defaultFontFamily, loadTerminalSettings, normalizeTerminalSettings, saveTerminalSettings, type TerminalSettings } from './settings.js';
import { terminalThemes } from './terminalThemes.js';
import { TerminalPane, type TerminalPaneHandle } from './TerminalPane.js';
import './style.css';

export function App() {
  const terminalMapRef = useRef<Map<string, TerminalPaneHandle>>(new Map());
  const [sessions, setSessions] = useState<PtySessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<TerminalSettings>(() => loadTerminalSettings());
  const [editingAliasId, setEditingAliasId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; session: PtySessionSummary } | null>(null);

  // Split panes state
  interface PaneState {
    paneId: string;
    sessionId: string | null;
  }
  const [panes, setPanes] = useState<PaneState[]>([{ paneId: 'main', sessionId: null }]);
  const [activePaneId, setActivePaneId] = useState<string>('main');
  const [splitDirection, setSplitDirection] = useState<'horizontal' | 'vertical'>('horizontal');

  const activeSession = useMemo(() => {
    const pane = panes.find((p) => p.paneId === activePaneId);
    return pane?.sessionId ? sessions.find((s) => s.id === pane.sessionId) ?? null : null;
  }, [panes, activePaneId, sessions]);

  function reportError(cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    setError(message);
    const handle = terminalMapRef.current.get(activePaneId);
    handle?.getTerminal()?.write(`\r\n\x1b[31m${stripControlCharacters(message)}\x1b[0m\r\n`);
  }

  const refreshSessions = useCallback(async () => {
    const nextSessions = await listSessions();
    setSessions(nextSessions);
  }, []);

  useEffect(() => {
    if (!error) {
      return;
    }

    const timeout = window.setTimeout(() => setError(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [error]);

  useEffect(() => {
    void document.fonts.load(`13px MapleMonoNFLocal`).then(() => {
      saveTerminalSettings(normalizeTerminalSettings(settings));
    });
  }, [settings]);

  useEffect(() => {
    void refreshSessions().catch((cause) => reportError(cause));
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
            return;
          }

          if (event.type === 'session_updated') {
            setSessions((current) => current.map((s) => (s.id === event.session.id ? event.session : s)));
            return;
          }

          if (event.type === 'session_output') {
            const handle = terminalMapRef.current.get(event.sessionId);
            if (handle) {
              handle.write(event.chunk);
            }
            return;
          }

          if (event.type !== 'session_exit' && event.type !== 'session_closed') {
            void refreshSessions().catch((cause) => reportError(cause));
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

  // --- Pane management ---

  async function handleCreate() {
    try {
      setError(null);
      const result = await createSession();
      setSessions((current) => [result.session, ...current.filter((s) => s.id !== result.session.id)]);
      setPanes((current) => current.map((p) => (p.paneId === activePaneId ? { ...p, sessionId: result.session.id } : p)));
    } catch (cause) {
      reportError(cause);
    }
  }

  async function handleClose(sessionId: string) {
    try {
      setError(null);
      await closeSession(sessionId);
      setSessions((current) => current.filter((s) => s.id !== sessionId));
      setPanes((current) => current.map((p) => (p.sessionId === sessionId ? { ...p, sessionId: null } : p)));
    } catch (cause) {
      reportError(cause);
    }
  }

  function handlePaneSessionClick(sessionId: string) {
    setPanes((current) => current.map((p) => (p.paneId === activePaneId ? { ...p, sessionId } : p)));
  }

  function handleSplit(direction: 'horizontal' | 'vertical') {
    const newPaneId = crypto.randomUUID();
    setSplitDirection(direction);
    setPanes((current) => [...current, { paneId: newPaneId, sessionId: null }]);
    setActivePaneId(newPaneId);
    void createSession().then((result) => {
      setSessions((current) => [result.session, ...current.filter((s) => s.id !== result.session.id)]);
      setPanes((current) => current.map((p) => (p.paneId === newPaneId ? { ...p, sessionId: result.session.id } : p)));
    });
  }

  function handleUnsplit() {
    if (panes.length <= 1) {
      return;
    }

    setPanes([panes[0]]);
    setActivePaneId(panes[0].paneId);
  }

  function paneReconnect(paneId: string) {
    void createSession().then((result) => {
      setSessions((current) => [result.session, ...current.filter((s) => s.id !== result.session.id)]);
      setPanes((current) => current.map((p) => (p.paneId === paneId ? { ...p, sessionId: result.session.id } : p)));
    });
  }

  async function copySessionId(event: MouseEvent<HTMLButtonElement>, sessionId: string) {
    event.stopPropagation();

    try {
      await navigator.clipboard.writeText(sessionId);
      setError(`已复制 session id: ${sessionId}`);
    } catch {
      reportError('复制 session id 失败');
    }
  }

  async function handleRename(sessionId: string, rawValue: string) {
    try {
      const alias = rawValue.trim() || undefined;
      const session = await updateSessionAlias(sessionId, alias);
      setSessions((current) => current.map((item) => (item.id === session.id ? session : item)));
    } catch (cause) {
      reportError(cause);
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
      reportError(`复制 ${label} 失败`);
    }
  }

  // --- Drag reorder ---

  function handleDragStart(e: DragEvent<HTMLDivElement>, index: number) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>, index: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    (e.currentTarget as HTMLElement).style.opacity = '0.5';
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    (e.currentTarget as HTMLElement).style.opacity = '';
  }

  function handleDrop(e: DragEvent<HTMLDivElement>, toIndex: number) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).style.opacity = '';
    const fromIndex = Number(e.dataTransfer.getData('text/plain'));
    if (fromIndex === toIndex) {
      return;
    }

    setSessions((current) => {
      const items = [...current];
      const [moved] = items.splice(fromIndex, 1);
      items.splice(toIndex, 0, moved);
      return items;
    });
  }

  function updateSettings(nextSettings: TerminalSettings) {
    setSettings(normalizeTerminalSettings(nextSettings));
  }

  // --- Keyboard shortcuts ---

  useEffect(() => {
    const sessionsList = sessions;
    const activeSid = activeSession?.id;

    function onKeyDown(e: KeyboardEvent) {
      if (!e.metaKey || !e.shiftKey) {
        return;
      }

      if (e.key === '[') {
        e.preventDefault();
        const idx = sessionsList.findIndex((s) => s.id === activeSid);
        if (idx > 0) {
          handlePaneSessionClick(sessionsList[idx - 1].id);
        }
        return;
      }

      if (e.key === ']') {
        e.preventDefault();
        const idx = sessionsList.findIndex((s) => s.id === activeSid);
        if (idx < sessionsList.length - 1) {
          handlePaneSessionClick(sessionsList[idx + 1].id);
        }
        return;
      }

      if (e.key === '-') {
        e.preventDefault();
        if (panes.length <= 1) {
          handleSplit('horizontal');
        } else {
          setSplitDirection((d) => (d === 'horizontal' ? 'vertical' : 'horizontal'));
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, activeSession?.id, panes.length]);

  // --- Render ---

  function renderTerminalPane(pane: PaneState) {
    return (
      <TerminalPane
        key={pane.paneId}
        sessionId={pane.sessionId}
        settings={settings}
        onReady={(handle) => terminalMapRef.current.set(pane.paneId, handle)}
        onUnready={() => terminalMapRef.current.delete(pane.paneId)}
        onError={(cause) => reportError(cause)}
        onReconnect={() => paneReconnect(pane.paneId)}
      />
    );
  }

  function renderWorkspace() {
    if (panes.length === 1) {
      return (
        <div className="paneWrapper" onClick={() => setActivePaneId(panes[0].paneId)}>
          {renderTerminalPane(panes[0])}
        </div>
      );
    }

    return (
      <Group orientation={splitDirection} className="paneGroup">
        {panes.map((pane, i) => (
          <Fragment key={pane.paneId}>
            {i > 0 && <Separator className="resizeHandle" />}
            <Panel minSize={15} onClick={() => setActivePaneId(pane.paneId)}>
              <div className={`paneWrapper${pane.paneId === activePaneId ? ' paneActive' : ''}`}>
                {renderTerminalPane(pane)}
              </div>
            </Panel>
          </Fragment>
        ))}
      </Group>
    );
  }

  return (
    <main className="app">
      <header className="tabBar">
        <button className="tabIconBtn" onClick={() => setSettingsOpen(true)} title="设置 (⌘⇧,)">⚙</button>
        <div className="tabList">
          {sessions.map((session, index) => (
            <div
              className={`tab${activeSession?.id === session.id ? ' active' : ''}`}
              key={session.id}
              draggable
              onClick={() => handlePaneSessionClick(session.id)}
              onContextMenu={(event) => openContextMenu(event as unknown as MouseEvent, session)}
              role="tab"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  handlePaneSessionClick(session.id);
                }
              }}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
            >
              {editingAliasId === session.id ? (
                <input
                  className="tabRenameInput"
                  defaultValue={session.alias ?? ''}
                  placeholder={session.command}
                  autoFocus
                  maxLength={80}
                  onBlur={(e) => {
                    setEditingAliasId(null);
                    void handleRename(session.id, e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
                    if (e.key === 'Escape') { setEditingAliasId(null); }
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="tabTitle" onDoubleClick={() => setEditingAliasId(session.id)}>
                  {session.alias || session.command}
                </span>
              )}
              <span className="tabMeta">{session.id.slice(0, 8)}</span>
              <button className="tabClose" onClick={(e) => { e.stopPropagation(); void handleClose(session.id); }} title="关闭会话">×</button>
            </div>
          ))}
          <button className="tabNew" onClick={() => void handleCreate()} title="新建会话 (⌘⇧N)">+</button>
        </div>
        <div className="tabActions">
          <span className="tabKeyHint">⌘⇧[ ]</span>
          {panes.length > 1 ? (
            <button className="tabIconBtn" onClick={handleUnsplit} title="取消拆分">⊞</button>
          ) : null}
          <button className="tabIconBtn" onClick={() => {
            if (panes.length <= 1) {
              handleSplit('horizontal');
            } else {
              setSplitDirection((d) => (d === 'horizontal' ? 'vertical' : 'horizontal'));
            }
          }} title="切换拆分方向 (⌘⇧-)">
            {splitDirection === 'horizontal' ? '↔' : '↕'}
          </button>
          {activeSession ? (
            <button className="tabIconBtn tabIconDanger" onClick={() => void handleClose(activeSession.id)} title="停止会话">✕</button>
          ) : null}
        </div>
      </header>
      <section className="workspace">
        {renderWorkspace()}
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
