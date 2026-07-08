import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const apiBase = process.env.PTY_TERMINAL_API_BASE ?? 'http://127.0.0.1:8787';
const server = new McpServer({
  name: 'pty-mcp-terminal',
  version: '0.1.0',
});

server.tool(
  'pty_create',
  'Create a real interactive PTY session. Waits 3 seconds by default, returns the captured output, and explicitly reports whether the process is still running.',
  {
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    env: z.record(z.string()).optional(),
    cols: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional(),
    cursorId: z.string().optional(),
    initialWaitMs: z.number().int().min(0).max(10_000).optional(),
  },
  async (input) => jsonResult(await postJson('/api/sessions', input)),
);

server.tool('pty_list', 'List active PTY sessions.', {}, async () => jsonResult(await getJson('/api/sessions')));

server.tool(
  'pty_read',
  'Read output since the last read for this sessionId and cursorId, then advance the cursor.',
  {
    sessionId: z.string(),
    cursorId: z.string().optional(),
  },
  async ({ sessionId, cursorId }) => {
    const params = new URLSearchParams({ cursorId: cursorId ?? 'default' });
    return jsonResult(await getJson(`/api/sessions/${encodeURIComponent(sessionId)}/read?${params}`));
  },
);

server.tool(
  'pty_write',
  'Write stdin data to a PTY session.',
  {
    sessionId: z.string(),
    input: z.string(),
  },
  async ({ sessionId, input }) => {
    await postJson(`/api/sessions/${encodeURIComponent(sessionId)}/write`, { input });
    return jsonResult({ ok: true });
  },
);

server.tool(
  'pty_close',
  'Close a PTY session.',
  {
    sessionId: z.string(),
  },
  async ({ sessionId }) => {
    await deleteJson(`/api/sessions/${encodeURIComponent(sessionId)}`);
    return jsonResult({ ok: true });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);

async function getJson(path: string): Promise<unknown> {
  return parseJsonResponse(await fetch(`${apiBase}${path}`));
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  return parseJsonResponse(
    await fetch(`${apiBase}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

async function deleteJson(path: string): Promise<void> {
  await parseJsonResponse(await fetch(`${apiBase}${path}`, { method: 'DELETE' }));
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return { ok: true };
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || response.statusText);
  }

  return text ? JSON.parse(text) : { ok: true };
}

function jsonResult(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}
