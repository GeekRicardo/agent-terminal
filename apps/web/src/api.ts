import type { CreatePtySessionResponse, PtySessionSummary, PtySnapshotResponse } from '@pty-terminal/shared';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8787';

export function wsUrl(): string {
  const base = new URL(API_BASE);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = '/ws';
  return base.toString();
}

export async function listSessions(): Promise<PtySessionSummary[]> {
  const result = await request<{ sessions: PtySessionSummary[] }>('/api/sessions');
  return result.sessions;
}

export async function createSession(): Promise<CreatePtySessionResponse> {
  return request('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ cursorId: 'web-create', initialWaitMs: 300 }),
  });
}

export async function getSnapshot(sessionId: string): Promise<PtySnapshotResponse> {
  return request(`/api/sessions/${sessionId}/snapshot`);
}

export async function writeToSession(sessionId: string, input: string): Promise<void> {
  await request(`/api/sessions/${sessionId}/write`, {
    method: 'POST',
    body: JSON.stringify({ input }),
  });
}

export async function resizeSession(sessionId: string, cols: number, rows: number): Promise<void> {
  await request(`/api/sessions/${sessionId}/resize`, {
    method: 'POST',
    body: JSON.stringify({ cols, rows }),
  });
}

export async function updateSessionAlias(sessionId: string, alias: string | undefined): Promise<PtySessionSummary> {
  const result = await request<{ session: PtySessionSummary }>(`/api/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ alias }),
  });
  return result.session;
}

export async function closeSession(sessionId: string): Promise<void> {
  await request(`/api/sessions/${sessionId}`, { method: 'DELETE' });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'content-type': 'application/json', ...init.headers },
    ...init,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
