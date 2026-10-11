import { type ChildProcess, fork, spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import MigrationFacade, { MigrationPreparationFacade } from '../facade.ts';
import type { CreateResult, DownResult, MigrationOperations, MigrationStatus, UpResult } from '../types.ts';
import { createMigrationPreparationWorker, createMigrationWorker } from '../worker.ts';
import { deserializeMigrationError, MigrationUncertainStateError, MongoHistoryPreflightError } from './errors.ts';
import type { IsolatedMongoOptions, MongoOperation, MongoProcessObservation, MongoWorkerRequest, MongoWorkerResponse } from './mongo-protocol.ts';

interface OwnedMongoProcess {
  child: ChildProcess;
  closed: boolean;
  terminal: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

const ownedMongoProcesses = new Set<OwnedMongoProcess>();
const operationTimeoutMs = 20_000;
const gracefulTerminationMs = 2_000;
const forceTerminationMs = 5_000;

function workerPath(): string {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const callerRoot = path.dirname(moduleDirectory);
  const callerFormat = path.basename(callerRoot);
  const distRoot = (callerFormat === 'esm' || callerFormat === 'cjs') && path.basename(path.dirname(callerRoot)) === 'dist' ? path.dirname(callerRoot) : path.resolve(moduleDirectory, '../../dist');
  return path.join(distRoot, 'esm', 'workers', 'mongo-operation.js');
}

function withTimeout<T>(operation: Promise<T>, label: string, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for isolated Mongo ${label}`)), timeoutMs);
    operation.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function taskkill(pid: number, force: boolean): void {
  const result = spawnSync('taskkill.exe', ['/pid', String(pid), '/t', ...(force ? ['/f'] : [])], { encoding: 'utf8', timeout: 5_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`taskkill exited ${result.status ?? result.signal ?? 'unknown'}: ${result.stderr}`);
}

function terminateTree(process: OwnedMongoProcess, force: boolean): void {
  const pid = process.child.pid;
  if (pid === undefined || process.closed) return;
  if (globalThis.process.platform === 'win32') return taskkill(pid, force);
  try {
    globalThis.process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

async function terminateAndAwait(process: OwnedMongoProcess): Promise<void> {
  if (process.closed) return;
  let gracefulError: unknown;
  try {
    terminateTree(process, false);
  } catch (error) {
    gracefulError = error;
  }
  try {
    await withTimeout(process.terminal, 'graceful process termination', gracefulTerminationMs);
  } catch (gracefulFailure) {
    let forceError: unknown;
    try {
      terminateTree(process, true);
    } catch (error) {
      forceError = error;
    }
    try {
      await withTimeout(process.terminal, 'forced process termination', forceTerminationMs);
    } catch (forceFailure) {
      const error = new Error(`Isolated Mongo process ${process.child.pid ?? 'without pid'} remained live after forced termination`) as Error & { gracefulFailure?: unknown; forceError?: unknown; forceFailure?: unknown };
      error.gracefulFailure = gracefulFailure;
      error.forceError = forceError;
      error.forceFailure = forceFailure;
      throw error;
    }
    if (forceError) throw forceError;
    return;
  }
  if (gracefulError) throw gracefulError;
}

function responseError(response: Extract<MongoWorkerResponse, { ok: false }>): Error {
  const cause = deserializeMigrationError(response.error.cause);
  let error: Error;
  if (response.error.kind === 'preflight') {
    error = new MongoHistoryPreflightError(response.error.operation, response.error.code, response.error.ids, cause.message);
  } else if (response.error.kind === 'uncertain') {
    error = new MigrationUncertainStateError(response.error.operation, cause, response.error.completedIds, response.error.historyInspected);
  } else {
    error = cause;
  }
  if (response.cleanupError) (error as Error & { cleanupError?: Error }).cleanupError = deserializeMigrationError(response.cleanupError);
  return error;
}

async function runMongoOperation<T>(request: MongoWorkerRequest, observe?: (observation: MongoProcessObservation) => void): Promise<T> {
  const child = fork(workerPath(), [JSON.stringify(request)], {
    detached: globalThis.process.platform !== 'win32',
    serialization: 'json',
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '';
  let response: MongoWorkerResponse | undefined;
  let launchError: Error | undefined;
  const postSpawnErrors: Error[] = [];
  let spawned = false;
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.once('spawn', () => {
    spawned = true;
  });
  child.on('message', (message: unknown) => {
    response = message as MongoWorkerResponse;
  });
  child.on('error', (error) => {
    if (!spawned && child.pid === undefined && !launchError) launchError = error;
    else postSpawnErrors.push(error);
  });

  let resolveTerminal: ((terminal: { code: number | null; signal: NodeJS.Signals | null }) => void) | undefined;
  const terminal = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    resolveTerminal = resolve;
  });
  const owned: OwnedMongoProcess = { child, closed: false, terminal };
  ownedMongoProcesses.add(owned);
  child.once('close', (code, signal) => {
    owned.closed = true;
    ownedMongoProcesses.delete(owned);
    resolveTerminal?.({ code, signal });
  });

  try {
    const exit = await withTimeout(terminal, `${request.operation} process`, operationTimeoutMs);
    const observation: MongoProcessObservation = {
      operation: request.operation,
      databaseName: request.databaseName,
      migrationsDir: request.migrationsDir,
      pid: response?.pid ?? child.pid ?? null,
      clientOpened: response?.clientOpened ?? false,
      clientClosed: response?.clientClosed ?? false,
      exitCode: exit.code,
      signal: exit.signal,
      workerPath: response?.workerPath ?? null,
      commandNames: response?.commandNames ?? [],
    };
    if (request.operation === 'create' || request.operation === 'status') {
      const outcome = ((): { ok: true; result: T } | { ok: false; error: unknown } => {
        try {
          if (launchError) throw launchError;
          if (postSpawnErrors[0]) throw postSpawnErrors[0];
          if (!response) throw new Error(`Isolated Mongo ${request.operation} process exited without a result (${exit.code ?? exit.signal ?? 'unknown'}): ${stderr}`);
          if (exit.code !== 0 || exit.signal !== null) throw new Error(`Isolated Mongo ${request.operation} process failed (${exit.code ?? exit.signal ?? 'unknown'}): ${stderr}`);
          if (!response.ok) throw responseError(response);
          if (!response.clientClosed) throw new Error(`Isolated Mongo ${request.operation} process reported an open client`);
          return { ok: true, result: response.result as T };
        } catch (error) {
          return { ok: false, error };
        }
      })();
      try {
        observe?.(observation);
      } catch (observerFailure) {
        if (outcome.ok === false) throw new AggregateError([outcome.error, observerFailure], 'Isolated Mongo operation and observer failed');
        throw observerFailure;
      }
      if (outcome.ok === false) throw outcome.error;
      return outcome.result;
    }
    observe?.(observation);
    if (launchError) throw launchError;
    if (postSpawnErrors[0]) throw postSpawnErrors[0];
    if (!response) throw new Error(`Isolated Mongo ${request.operation} process exited without a result (${exit.code ?? exit.signal ?? 'unknown'}): ${stderr}`);
    if (exit.code !== 0 || exit.signal !== null) throw new Error(`Isolated Mongo ${request.operation} process failed (${exit.code ?? exit.signal ?? 'unknown'}): ${stderr}`);
    if (!response.ok) throw responseError(response);
    if (!response.clientClosed) throw new Error(`Isolated Mongo ${request.operation} process reported an open client`);
    return response.result as T;
  } catch (error) {
    const primary = error instanceof Error ? error : new Error(String(error));
    if (!owned.closed) {
      try {
        await terminateAndAwait(owned);
      } catch (cleanupError) {
        (primary as Error & { cleanupError?: unknown }).cleanupError = cleanupError;
      }
    }
    throw primary;
  }
}

export async function closeOwnedMongoProcesses(): Promise<void> {
  const outcomes = await Promise.allSettled([...ownedMongoProcesses].map(terminateAndAwait));
  const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
  if (failures.length > 0) {
    const error = new Error(`Failed to close ${failures.length} isolated Mongo process(es)`) as Error & { failures?: unknown[] };
    error.failures = failures.map((outcome) => (outcome.status === 'rejected' ? outcome.reason : undefined));
    throw error;
  }
}

export function createIsolatedMongoFacade(options: IsolatedMongoOptions, observe?: (observation: MongoProcessObservation) => void): MigrationFacade {
  const request = (operation: MongoOperation, name?: string): MongoWorkerRequest => ({ ...options, operation, ...(name === undefined ? {} : { name }) });
  const operations: MigrationOperations = {
    create(name): Promise<CreateResult> {
      return runMongoOperation(request('create', name), observe);
    },
    status(): Promise<MigrationStatus[]> {
      return runMongoOperation(request('status'), observe);
    },
    up(): Promise<UpResult> {
      return runMongoOperation(request('up'), observe);
    },
    down(): Promise<DownResult> {
      return runMongoOperation(request('down'), observe);
    },
  };
  return new MigrationFacade(createMigrationWorker(operations));
}

export function createMongoPreparationFacade(options: IsolatedMongoOptions, observe?: (observation: MongoProcessObservation) => void): MigrationPreparationFacade {
  const target = { ...options, migrationsDir: path.resolve(options.migrationsDir), createDir: path.resolve(options.createDir) };
  return new MigrationPreparationFacade(createMigrationPreparationWorker({
    create(name) {
      return runMongoOperation<CreateResult>({ ...target, operation: 'create', name }, observe);
    },
    status() {
      return runMongoOperation<MigrationStatus[]>({ ...target, operation: 'status' }, observe);
    },
  }));
}
