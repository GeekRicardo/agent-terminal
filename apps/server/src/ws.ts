import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import type { PtyManager } from './pty/PtyManager.js';

export function attachWebSocketServer(server: Server, manager: PtyManager): void {
  const wss = new WebSocketServer({ server, path: '/ws' });

  manager.on('event', (event) => {
    const payload = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
    }
  });
}
