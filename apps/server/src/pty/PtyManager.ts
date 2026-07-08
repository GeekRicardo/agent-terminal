import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { nanoid } from 'nanoid';
import pty, { type IPty } from 'node-pty';
import type {
  CreatePtySessionRequest,
  CreatePtySessionResponse,
  PtyKeepAliveSummary,
  PtyReadResponse,
  PtySessionSummary,
  PtySnapshotResponse,
  ServerEvent,
} from '@pty-terminal/shared';
import { OutputBuffer } from './OutputBuffer.js';
import { cleanForAgent } from './output.js';

const DEFAULT_INITIAL_WAIT_MS = 3000;
const MAX_INITIAL_WAIT_MS = 10_000;
const MAX_BUFFER_LENGTH = 2_000_000;
const SSH_KEEP_ALIVE_INTERVAL_SECONDS = 60;
const SSH_KEEP_ALIVE_TOLERATE_IDLE_DAYS = 7;
const SSH_KEEP_ALIVE_COUNT_MAX = (SSH_KEEP_ALIVE_TOLERATE_IDLE_DAYS * 24 * 60 * 60) / SSH_KEEP_ALIVE_INTERVAL_SECONDS;

interface PtySessionState {
  id: string;
  command: string;
  alias?: string;
  args: string[];
  cwd: string;
  createdAt: Date;
  status: 'running' | 'exited';
  exitCode?: number;
  process: IPty;
  output: OutputBuffer;
  keepAlive?: PtyKeepAliveSummary;
}

export class PtyManager extends EventEmitter<{ event: [ServerEvent] }> {
  private readonly sessions = new Map<string, PtySessionState>();

  async createSession(request: CreatePtySessionRequest = {}): Promise<CreatePtySessionResponse> {
    const id = nanoid();
    const command = request.command ?? defaultShell();
    const requestedArgs = request.args ?? [];
    const { args, keepAlive } = withKeepAlive(command, requestedArgs);
    const cwd = path.resolve(request.cwd ?? process.cwd());
    const cursorId = request.cursorId ?? 'default';
    const initialWaitMs = clamp(request.initialWaitMs ?? DEFAULT_INITIAL_WAIT_MS, 0, MAX_INITIAL_WAIT_MS);

    const child = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols: request.cols ?? 100,
      rows: request.rows ?? 30,
      cwd,
      env: normalizeEnv({ ...process.env, ...request.env }),
    });

    const session: PtySessionState = {
      id,
      command,
      args,
      cwd,
      createdAt: new Date(),
      status: 'running',
      process: child,
      output: new OutputBuffer(MAX_BUFFER_LENGTH),
      keepAlive,
    };

    this.sessions.set(id, session);
    child.onData((chunk) => this.appendOutput(session, chunk));
    child.onExit(({ exitCode }) => {
      session.status = 'exited';
      session.exitCode = exitCode;
      this.emit('event', { type: 'session_exit', sessionId: id, exitCode });
    });

    this.emit('event', { type: 'session_created', session: this.toSummary(session) });
    await delay(initialWaitMs);

    const initial = this.read(id, cursorId);
    const summary = this.toSummary(session);
    const stillRunning = summary.status === 'running';
    return {
      session: summary,
      cursorId,
      output: initial.output,
      rawOutput: initial.rawOutput,
      initialWaitMs,
      stillRunning,
      message: stillRunning
        ? `已获取 ${formatSeconds(initialWaitMs)} 输出，进程仍在执行。后续请使用 sessionId=${id} 和 cursorId=${cursorId} 增量读取。`
        : `进程已在 ${formatSeconds(initialWaitMs)} 内退出，已返回全部已捕获输出。`,
    };
  }

  listSessions(): PtySessionSummary[] {
    return [...this.sessions.values()].map((session) => this.toSummary(session));
  }

  getSnapshot(sessionId: string): PtySnapshotResponse {
    const session = this.requireSession(sessionId);
    return {
      session: this.toSummary(session),
      rawOutput: session.output.snapshot(),
    };
  }

  read(sessionId: string, cursorId = 'default'): PtyReadResponse {
    const session = this.requireSession(sessionId);
    const { rawOutput, fromOffset, toOffset } = session.output.read(cursorId);

    return {
      sessionId,
      cursorId,
      output: cleanForAgent(rawOutput),
      rawOutput,
      fromOffset,
      toOffset,
    };
  }

  write(sessionId: string, input: string): void {
    const session = this.requireSession(sessionId);
    if (session.status !== 'running') {
      throw new Error(`PTY session ${sessionId} has exited`);
    }

    session.process.write(input);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.requireSession(sessionId);
    if (session.status !== 'running') {
      return;
    }

    session.process.resize(cols, rows);
  }

  updateAlias(sessionId: string, alias: string | undefined): PtySessionSummary {
    const session = this.requireSession(sessionId);
    session.alias = alias;
    const summary = this.toSummary(session);
    this.emit('event', { type: 'session_updated', session: summary });
    return summary;
  }

  close(sessionId: string): void {
    const session = this.requireSession(sessionId);
    session.process.kill();
    this.sessions.delete(sessionId);
    this.emit('event', { type: 'session_closed', sessionId });
  }

  private appendOutput(session: PtySessionState, chunk: string): void {
    session.output.append(chunk);
    this.emit('event', { type: 'session_output', sessionId: session.id, chunk });
  }

  private requireSession(sessionId: string): PtySessionState {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`PTY session ${sessionId} not found`);
    }
    return session;
  }

  private toSummary(session: PtySessionState): PtySessionSummary {
    return {
      id: session.id,
      command: session.command,
      alias: session.alias,
      args: session.args,
      cwd: session.cwd,
      createdAt: session.createdAt.toISOString(),
      status: session.status,
      exitCode: session.exitCode,
      keepAlive: session.keepAlive,
    };
  }
}

function defaultShell(): string {
  return process.env.SHELL ?? (os.platform() === 'win32' ? 'powershell.exe' : '/bin/sh');
}

function normalizeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function withKeepAlive(command: string, args: string[]): { args: string[]; keepAlive?: PtyKeepAliveSummary } {
  if (path.basename(command) !== 'ssh') {
    return { args };
  }

  const keepAlive: PtyKeepAliveSummary = {
    enabled: true,
    strategy: 'ssh-server-alive',
    intervalSeconds: SSH_KEEP_ALIVE_INTERVAL_SECONDS,
    tolerateIdleDays: SSH_KEEP_ALIVE_TOLERATE_IDLE_DAYS,
  };

  const hasServerAliveInterval = hasSshOption(args, 'ServerAliveInterval');
  const hasServerAliveCountMax = hasSshOption(args, 'ServerAliveCountMax');
  const injectedArgs = [...args];

  if (!hasServerAliveInterval) {
    injectedArgs.unshift('-o', `ServerAliveInterval=${SSH_KEEP_ALIVE_INTERVAL_SECONDS}`);
  }

  if (!hasServerAliveCountMax) {
    injectedArgs.unshift('-o', `ServerAliveCountMax=${SSH_KEEP_ALIVE_COUNT_MAX}`);
  }

  return { args: injectedArgs, keepAlive };
}

function hasSshOption(args: string[], optionName: string): boolean {
  return args.some((arg, index) => {
    if (arg === '-o') {
      return args[index + 1]?.toLowerCase().startsWith(`${optionName.toLowerCase()}=`) ?? false;
    }

    return arg.toLowerCase().startsWith(`-o${optionName.toLowerCase()}=`);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatSeconds(ms: number): string {
  return ms % 1000 === 0 ? `${ms / 1000} 秒` : `${ms}ms`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
