import http from 'node:http';
import { PtyManager } from './pty/PtyManager.js';
import { createHttpApp } from './http.js';
import { attachWebSocketServer } from './ws.js';

const port = Number(process.env.PORT ?? 8787);
const manager = new PtyManager();
const app = createHttpApp(manager);
const server = http.createServer(app);

attachWebSocketServer(server, manager);

server.listen(port, () => {
  console.error(`PTY terminal server listening on http://localhost:${port}`);
});
