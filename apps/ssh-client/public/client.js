import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

// ── DOM refs ──────────────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);
const form    = $('#sshForm');
const formDiv = $('#connectForm');
const termDiv = $('#terminalArea');
const termEl  = $('#terminal');
const titleEl = $('#connTitle');
const subEl   = $('#connSubtitle');
const statusEl = $('#connStatus');
const msgEl   = $('#statusMsg');

// ── xterm.js ──────────────────────────────────────────────────────────────

const terminal = new Terminal({
  cursorBlink: true,
  fontSize: 13,
  theme: {
    background: '#0b1020',
    foreground: '#e5e7eb',
    cursor: '#60a5fa',
    black: '#1e1e2e',
    red: '#f38ba8',
    green: '#a6e3a1',
    yellow: '#f9e2af',
    blue: '#89b4fa',
    magenta: '#f5c2e7',
    cyan: '#94e2d5',
    white: '#bac2de',
    brightBlack: '#585b70',
    brightRed: '#f38ba8',
    brightGreen: '#a6e3a1',
    brightYellow: '#f9e2af',
    brightBlue: '#89b4fa',
    brightMagenta: '#f5c2e7',
    brightCyan: '#94e2d5',
    brightWhite: '#a6adc8',
  },
});

const fitAddon = new FitAddon();
terminal.loadAddon(fitAddon);

// ── Connection state ──────────────────────────────────────────────────────

let ws = null;
let connected = false;

// ── Form submit ───────────────────────────────────────────────────────────

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (connected) return;

  const fd = new FormData(form);
  const host = fd.get('host').trim();
  if (!host) return;

  const params = new URLSearchParams({
    host,
    port: fd.get('port') || '22',
    cols: String(terminal.cols || 100),
    rows: String(terminal.rows || 30),
  });

  const user = fd.get('user').toString().trim();
  if (user) params.set('user', user);

  const args = fd.get('args').toString().trim();
  if (args) params.set('args', args);

  connect(params, `${user ? user + '@' : ''}${host}`);
});

// ── Disconnect ────────────────────────────────────────────────────────────

$('#disconnectBtn').addEventListener('click', disconnect);

function disconnect() {
  if (ws) {
    ws.close();
    ws = null;
  }
  connected = false;
  showForm();
  terminal.clear();
}

// ── WebSocket connection ──────────────────────────────────────────────────

function connect(params, label) {
  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${wsProtocol}//${location.host}/ws?${params}`;

  setStatus('连接中...');
  setBtnDisabled(true);

  ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    // Show terminal area (connection confirmed when we get 'connected' msg)
  };

  ws.onmessage = (event) => {
    const raw = event.data;

    // Try to parse as JSON control message
    if (raw instanceof ArrayBuffer || raw instanceof Blob) {
      terminal.write(raw);
      return;
    }

    const str = String(raw);
    if (str.startsWith('{')) {
      try {
        const msg = JSON.parse(str);
        if (msg.type === 'connected') {
          connected = true;
          showTerminal(label);
          terminal.focus();
          fitAddon.fit();
          setStatus('已连接');
          setBtnDisabled(false);
          return;
        }
        if (msg.type === 'exit') {
          terminal.write(`\r\n\x1b[33m进程已退出，退出码: ${msg.code}\x1b[0m\r\n`);
          setStatus(`已断开 (退出码 ${msg.code})`);
          connected = false;
          return;
        }
        if (msg.type === 'error') {
          setStatus(msg.message, true);
          setBtnDisabled(false);
          return;
        }
        return; // unknown JSON, ignore
      } catch { /* not JSON, treat as terminal output */ }
    }

    terminal.write(str);
  };

  ws.onerror = () => {
    setStatus('WebSocket 连接失败', true);
    setBtnDisabled(false);
    connected = false;
  };

  ws.onclose = () => {
    if (connected) {
      terminal.write(`\r\n\x1b[33m连接已断开\x1b[0m\r\n`);
    }
    connected = false;
    setStatus('已断开');
    setBtnDisabled(false);
    ws = null;
  };
}

// ── Terminal data → WebSocket ─────────────────────────────────────────────

terminal.onData((data) => {
  if (ws && connected) {
    ws.send(data);
  }
});

// ── Resize handling ───────────────────────────────────────────────────────

const resizeObserver = new ResizeObserver(() => {
  if (!connected || !ws) return;
  try {
    fitAddon.fit();
    const { cols, rows } = terminal;
    if (cols > 0 && rows > 0) {
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  } catch { /* ignore */ }
});

// ── UI helpers ────────────────────────────��───────────────────────────────

function showForm() {
  formDiv.classList.remove('hidden');
  termDiv.classList.add('hidden');
  terminal.dispose();
}

function showTerminal(label) {
  formDiv.classList.add('hidden');
  termDiv.classList.remove('hidden');
  titleEl.textContent = label;
  subEl.textContent = location.hostname !== '127.0.0.1'
    ? `通过 ${location.hostname} 代理`
    : '本地代理';
  terminal.open(termEl);
  resizeObserver.observe(termEl);
}

function setStatus(msg, isError = false) {
  msgEl.textContent = msg;
  msgEl.className = isError ? 'error' : '';
  statusEl.textContent = msg;
}

function setBtnDisabled(disabled) {
  $('#connectBtn').disabled = disabled;
}
