export type PtySessionStatus = 'running' | 'exited';

export interface PtySessionSummary {
  id: string;
  command: string;
  alias?: string;
  args: string[];
  cwd: string;
  createdAt: string;
  status: PtySessionStatus;
  exitCode?: number;
  keepAlive?: PtyKeepAliveSummary;
}

export interface PtyKeepAliveSummary {
  enabled: boolean;
  strategy: 'ssh-server-alive';
  intervalSeconds: number;
  tolerateIdleDays: number;
}

export interface CreatePtySessionRequest {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  cursorId?: string;
  initialWaitMs?: number;
}

export interface CreatePtySessionResponse {
  session: PtySessionSummary;
  cursorId: string;
  output: string;
  rawOutput: string;
  initialWaitMs: number;
  stillRunning: boolean;
  message: string;
}

export interface PtyReadResponse {
  sessionId: string;
  cursorId: string;
  output: string;
  rawOutput: string;
  fromOffset: number;
  toOffset: number;
}

export interface PtySnapshotResponse {
  session: PtySessionSummary;
  rawOutput: string;
}

export interface UpdatePtySessionRequest {
  alias?: string;
}

export type ServerEvent =
  | { type: 'session_created'; session: PtySessionSummary }
  | { type: 'session_updated'; session: PtySessionSummary }
  | { type: 'session_output'; sessionId: string; chunk: string }
  | { type: 'session_exit'; sessionId: string; exitCode?: number }
  | { type: 'session_closed'; sessionId: string };
