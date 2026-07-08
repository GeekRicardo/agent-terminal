import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pty from 'node-pty';
import { WebSocketServer } from 'ws';

const PORT = parseInt(process.env.PORT || '5174', 10);
const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

// ── HTTP: serve static files ──────────────────────────────────────────────

const server = createServer((req, res) => {
  let filePath = join(PUBLIC, req.url === '/' ? 'index.html' : req.url);

  // Security: prevent directory traversal
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403).end();
    return;
  }

  if (!existsSync(filePath) || !filePath.startsWith(PUBLIC)) {
    filePath = join(PUBLIC, 'index.html');
  }

  const ext = extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(readFileSync(filePath));
});

// ── WebSocket: proxy → SSH PTY ────────────────────────────────────────────

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const host = url.searchParams.get('host') || '';
  const user = url.searchParams.get('user') || '';
  const port = url.searchParams.get('port') || '22';
  const extra = (url.searchParams.get('args') || '').trim();
  const cols  = parseInt(url.searchParams.get('cols') || '100', 10);
  const rows  = parseInt(url.searchParams.get('rows') || '30', 10);

  if (!host) {
    ws.send(JSON.stringify({ type: 'error', message: '缺少目标主机 (host)' }));
    ws.close();
    return;
  }

  const sshArgs = ['-tt', '-p', port];
  if (extra) sshArgs.push(...extra.split(/\s+/).filter(Boolean));
  sshArgs.push(user ? `${user}@${host}` : host);

  const proc = pty.spawn('ssh', sshArgs, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: process.cwd(),
    env: { ...process.env },
  });

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    try { proc.kill(); } catch { /* already dead */ }
    try { ws.close(); } catch { /* already closed */ }
  };

  // SSH output → WebSocket (raw bytes)
  proc.onData((data) => { if (!closed) ws.send(data); });

  // SSH exit → notify & cleanup
  proc.onExit(({ exitCode }) => {
    if (!closed) {
      ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
      cleanup();
    }
  });

  // WebSocket input → SSH stdin
  ws.on('message', (data) => {
    if (closed) return;

    const raw = String(data);
    // Check for JSON control messages
    if (raw.startsWith('{')) {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'resize' && msg.cols && msg.rows) {
          proc.resize(msg.cols, msg.rows);
        }
        return;
      } catch { /* not JSON, treat as plain input */ }
    }

    proc.write(raw);
  });

  ws.on('close', cleanup);
  ws.on('error', cleanup);

  // Confirm connection
  ws.send(JSON.stringify({ type: 'connected', sessionId: host }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  SSH 客户端已启动: http://localhost:${PORT}\n`);
  if (process.argv.includes('--dev')) {
    console.log('  开发模式，编辑 public/ 下的文件后刷新即可\n');
  }
});
