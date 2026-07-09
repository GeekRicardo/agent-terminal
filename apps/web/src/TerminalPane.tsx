import { useEffect, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import type { TerminalSettings } from './settings.js';
import { getTerminalTheme } from './terminalThemes.js';
import { getSnapshot, resizeSession, writeToSession } from './api.js';

export interface TerminalPaneHandle {
  write(chunk: string): void;
  getTerminal(): Terminal | null;
}

interface TerminalPaneProps {
  sessionId: string | null;
  settings: TerminalSettings;
  onReady(handle: TerminalPaneHandle): void;
  onUnready(): void;
  onError(cause: unknown, options?: { writeToTerminal?: boolean }): void;
  onReconnect(): void;
}

export function TerminalPane({ sessionId, settings, onReady, onUnready, onError, onReconnect }: TerminalPaneProps) {
  const terminalHostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onUnreadyRef = useRef(onUnready);
  onUnreadyRef.current = onUnready;

  // Init terminal (once)
  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      theme: getTerminalTheme(settings.themeId).theme,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(terminalHostRef.current!);
    fit.fit();
    terminal.focus();

    const handle: TerminalPaneHandle = {
      write: (chunk) => terminal.write(chunk),
      getTerminal: () => terminal,
    };
    onReadyRef.current(handle);

    const fitAndResize = () => {
      fit.fit();
      const sid = sessionIdRef.current;
      if (sid && terminal.cols > 0 && terminal.rows > 0) {
        void resizeSession(sid, terminal.cols, terminal.rows).catch((cause) => onErrorRef.current(cause));
      }
    };

    terminal.onData((data) => {
      const sid = sessionIdRef.current;
      if (sid) {
        void writeToSession(sid, data).catch((cause) => {
          const msg = cause instanceof Error ? cause.message : String(cause);
          if (msg.includes('exited') || msg.includes('not found')) {
            onReconnectRef.current();
          } else {
            onErrorRef.current(cause);
          }
        });
      }
    });

    terminalRef.current = terminal;
    fitRef.current = fit;

    const resizeObserver = new ResizeObserver(() => fitAndResize());
    resizeObserver.observe(terminalHostRef.current!);

    const handleSelectionMouseUp = () => {
      if (terminal.hasSelection()) {
        const text = terminal.getSelection();
        if (text) {
          navigator.clipboard.writeText(text).catch(() => {});
        }
      }
    };
    terminalHostRef.current!.addEventListener('mouseup', handleSelectionMouseUp);

    return () => {
      resizeObserver.disconnect();
      terminalHostRef.current?.removeEventListener('mouseup', handleSelectionMouseUp);
      onUnreadyRef.current();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync settings
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.options.fontFamily = settings.fontFamily;
    terminal.options.fontSize = settings.fontSize;
    terminal.options.theme = getTerminalTheme(settings.themeId).theme;
    fitRef.current?.fit();
  }, [settings]);

  // Load snapshot when session changes
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    if (!sessionId) {
      terminal.clear();
      return;
    }

    terminal.clear();
    void getSnapshot(sessionId)
      .then((snapshot) => {
        // Only write tail of snapshot to avoid replaying old terminal
        // negotiation sequences as visible garbage
        const MAX_SNAPSHOT = 10_000;
        const raw = snapshot.rawOutput;
        if (raw.length > MAX_SNAPSHOT) {
          terminal.write(`\x1b[2m...（跳过 ${raw.length - MAX_SNAPSHOT} 字节历史输出）\x1b[0m\r\n`);
          terminal.write(raw.slice(-MAX_SNAPSHOT));
        } else {
          terminal.write(raw);
        }

        fitRef.current?.fit();
        if (terminal.cols > 0 && terminal.rows > 0) {
          void resizeSession(sessionId, terminal.cols, terminal.rows).catch((cause) => onErrorRef.current(cause));
        }
        terminal.focus();
      })
      .catch((cause) => onErrorRef.current(cause));
  }, [sessionId]);

  return (
    <div
      ref={terminalHostRef}
      className="terminal"
      onMouseDown={() => terminalRef.current?.focus()}
    />
  );
}
