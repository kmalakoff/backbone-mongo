import migrateMongo, { type Config } from 'migrate-mongo';
import { stat } from 'fs/promises';
import { MongoClient } from 'mongodb';
import path from 'path';
import { fileURLToPath } from 'url';
import { type MigrationError, MongoHistoryPreflightError, serializeMigrationError } from '../next/errors.ts';
import { preflightMongoHistory, readMongoHistoryIds } from '../next/mongo-history.ts';
import type { MongoWorkerRequest, MongoWorkerResponse } from '../next/mongo-protocol.ts';

const changelogCollectionName = 'changelog';
const workerPath = fileURLToPath(import.meta.url);
const commandNames: string[] = [];

function lifecycle(clientOpened: boolean, clientClosed: boolean): { pid: number; clientOpened: boolean; clientClosed: boolean; workerPath: string; commandNames: string[] } {
  return { pid: process.pid, clientOpened, clientClosed, workerPath, commandNames: [...commandNames] };
}

function configFor(request: MongoWorkerRequest, create: boolean): Config {
  return {
    mongodb: { url: request.uri, databaseName: request.databaseName, options: {} },
    migrationsDir: create ? request.createDir : request.migrationsDir,
    changelogCollectionName,
    lockCollectionName: 'changelog_lock',
    lockTtl: 0,
    migrationFileExtension: create ? '.ts' : '.js',
    useFileHash: false,
    moduleSystem: 'esm',
  };
}

function completedIds(operation: 'up' | 'down', before: string[], after: string[]): string[] {
  const comparison = new Set(operation === 'up' ? before : after);
  return (operation === 'up' ? after : before).filter((id) => !comparison.has(id));
}

async function execute(request: MongoWorkerRequest, client?: MongoClient): Promise<MongoWorkerResponse> {
  migrateMongo.config.set(configFor(request, request.operation === 'create'));

  if (request.operation === 'create') {
    if (!request.name) throw new Error('Mongo create requires a migration name');
    const template = path.join(request.createDir, 'sample-migration.ts');
    if (!(await stat(template)).isFile()) throw new Error('Mongo create requires a sample-migration.ts file');
    const sourceId = await migrateMongo.create(request.name);
    return { ok: true, result: { sourceId, deployedId: path.basename(sourceId).replace(/\.ts$/, '.js') }, ...lifecycle(false, true) };
  }

  if (!client) throw new Error('Mongo status/execution requires an owned client');
  const database = client.db(request.databaseName);

  if (request.operation === 'status') {
    try {
      await preflightMongoHistory(database, request.migrationsDir, '.js', changelogCollectionName, 'status');
    } catch (error) {
      if (!(error instanceof MongoHistoryPreflightError)) throw error;
      return { ok: false, error: { kind: 'preflight', operation: error.operation, code: error.code, ids: [...error.ids], cause: serializeMigrationError(error) }, ...lifecycle(true, false) };
    }
    const status = await migrateMongo.status(database);
    return {
      ok: true,
      result: status.map((item) => ({ id: item.fileName, state: item.appliedAt === 'PENDING' ? ('pending' as const) : ('applied' as const), ...(item.appliedAt === 'PENDING' ? {} : { appliedAt: item.appliedAt }) })),
      ...lifecycle(true, false),
    };
  }

  let before: string[];
  try {
    before = (await preflightMongoHistory(database, request.migrationsDir, '.js', changelogCollectionName, request.operation)).historyIds;
  } catch (error) {
    if (error instanceof MongoHistoryPreflightError) {
      return {
        ok: false,
        error: { kind: 'preflight', operation: error.operation, code: error.code, ids: [...error.ids], cause: serializeMigrationError(error) },
        ...lifecycle(true, false),
      };
    }
    throw error;
  }

  try {
    const migrated = request.operation === 'up' ? await migrateMongo.up(database, client) : await migrateMongo.down(database, client);
    return {
      ok: true,
      result: request.operation === 'up' ? { applied: migrated } : { reverted: migrated },
      ...lifecycle(true, false),
    };
  } catch (error) {
    const cause: MigrationError = error instanceof Error ? error : new Error(String(error));
    let knownCompletedIds: string[] = [];
    let historyInspected = true;
    try {
      const after = await readMongoHistoryIds(database, changelogCollectionName);
      knownCompletedIds = completedIds(request.operation, before, after);
    } catch (historyError) {
      historyInspected = false;
      cause.historyInspectionError = historyError instanceof Error ? historyError : new Error(String(historyError));
      if (Array.isArray(cause.migrated) && cause.migrated.every((id) => typeof id === 'string')) knownCompletedIds = [...cause.migrated];
    }
    return {
      ok: false,
      error: { kind: 'uncertain', operation: request.operation, completedIds: knownCompletedIds, historyInspected, cause: serializeMigrationError(cause) },
      ...lifecycle(true, false),
    };
  }
}

function send(response: MongoWorkerResponse): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!process.send) return reject(new Error('Isolated Mongo worker requires an IPC channel'));
    process.send(response, (error) => (error ? reject(error) : resolve()));
  });
}

async function main(): Promise<void> {
  const encoded = process.argv[2];
  if (!encoded) throw new Error('Isolated Mongo worker requires encoded options');
  const request = JSON.parse(encoded) as MongoWorkerRequest;
  const client = request.operation === 'create' ? undefined : new MongoClient(request.uri, { monitorCommands: request.operation === 'status' });
  client?.on('commandStarted', ({ commandName }) => commandNames.push(commandName));
  let clientOpened = false;
  let response: MongoWorkerResponse;
  try {
    if (client) {
      await client.connect();
      clientOpened = true;
    }
    response = await execute(request, client);
  } catch (error) {
    response = { ok: false, error: { kind: 'operation', cause: serializeMigrationError(error) }, ...lifecycle(clientOpened, false) };
  }

  try {
    await client?.close();
    response.clientClosed = true;
    response.commandNames = [...commandNames];
  } catch (error) {
    if (response.ok) {
      if (request.operation === 'up' || request.operation === 'down') {
        const result = response.result as { applied?: string[]; reverted?: string[] };
        response = {
          ok: false,
          error: { kind: 'uncertain', operation: request.operation, completedIds: result.applied ?? result.reverted ?? [], historyInspected: false, cause: serializeMigrationError(error) },
          ...lifecycle(clientOpened, false),
        };
      } else {
        response = { ok: false, error: { kind: 'operation', cause: serializeMigrationError(error) }, ...lifecycle(clientOpened, false) };
      }
    } else {
      response.cleanupError = serializeMigrationError(error);
    }
  }

  await send(response);
  process.disconnect();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
  if (process.connected) process.disconnect();
});
