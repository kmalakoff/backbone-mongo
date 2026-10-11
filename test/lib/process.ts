import { type ChildProcess, execFile, spawn } from 'node:child_process';

const CLEANUP_TIMEOUT_MS = 10_000;
export interface ProcessResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function bounded<T>(promise: Promise<T>, duration: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Owned process cleanup timed out')), duration);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function terminate(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) =>
      execFile('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: CLEANUP_TIMEOUT_MS }, (error) => {
        if (error) reject(error);
        else resolve();
      })
    );
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
  }
}

export function startOwnedProcess(command: string, args: readonly string[], cwd: string, timeoutMs: number) {
  const child = spawn(command, args, { cwd, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '';
  let stderr = '';
  let failure: Error | undefined;
  let stopping: Promise<void> | undefined;
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  child.once('error', (error) => {
    failure = error;
  });
  const closed = new Promise<ProcessResult>((resolve) => child.once('close', (status) => resolve({ status, stdout, stderr })));
  function stop(): Promise<void> {
    stopping ??= (async () => {
      await terminate(child);
      await bounded(closed, CLEANUP_TIMEOUT_MS);
    })();
    return stopping;
  }
  const timer = setTimeout(() => {
    failure = new Error(`Owned process exceeded ${timeoutMs}ms`);
    void stop().catch((error: unknown) => {
      failure = new AggregateError([failure, error], 'Owned process timeout cleanup failed');
    });
  }, timeoutMs);
  const result = closed.then(async (value) => {
    clearTimeout(timer);
    try {
      if (stopping) await stopping;
      if (failure) throw failure;
      return value;
    } catch (error: unknown) {
      console.error('Owned child captured status:', value.status);
      console.error(`Owned child captured stdout:\n${value.stdout}`);
      console.error(`Owned child captured stderr:\n${value.stderr}`);
      throw error;
    }
  });
  // A service owner awaits result during shutdown; observe early failures without losing them.
  void result.catch(() => undefined);
  return { child, result, stop };
}

export async function runOwnedProcess(command: string, args: readonly string[], options: { cwd: string; timeoutMs: number }): Promise<ProcessResult> {
  return startOwnedProcess(command, args, options.cwd, options.timeoutMs).result;
}
