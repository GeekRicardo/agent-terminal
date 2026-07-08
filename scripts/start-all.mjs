import { spawn } from 'node:child_process';

const root = new URL('..', import.meta.url);
const serverUrl = 'http://127.0.0.1:8787/api/sessions';
const children = [];
let shuttingDown = false;

if (await isServerRunning()) {
  console.log('[server] reuse existing server on http://localhost:8787');
} else {
  children.push(startProcess('server', 'node', ['apps/server/dist/index.js']));
}

children.push(startProcess('web', 'pnpm', ['--dir', 'apps/web', 'exec', 'vite', 'preview', '--host', '0.0.0.0', '--port', '5173']));

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('PTY MCP Terminal started:');
console.log('- Web:    http://localhost:5173');
console.log('- Server: http://localhost:8787');
console.log('Press Ctrl-C to stop started processes.');

function startProcess(name, command, args) {
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => prefixOutput(name, chunk));
  child.stderr.on('data', (chunk) => prefixOutput(name, chunk));
  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    console.error(`[${name}] exited with ${signal ?? code}`);
    shutdown(code ?? 1);
  });

  return child;
}

async function isServerRunning() {
  try {
    const response = await fetch(serverUrl);
    return response.ok;
  } catch {
    return false;
  }
}

function prefixOutput(name, chunk) {
  for (const line of chunk.toString().split(/\r?\n/)) {
    if (line) {
      console.log(`[${name}] ${line}`);
    }
  }
}

function shutdown(code) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }

  setTimeout(() => process.exit(code), 200).unref();
}
