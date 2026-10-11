import type { CreateResult, DownResult, MigrationStatus, UpResult } from '../types.ts';
import type { HistoryOperation, MutationOperation, SerializedMigrationError } from './errors.ts';

export type MongoOperation = 'create' | 'status' | MutationOperation;

export interface IsolatedMongoOptions {
  uri: string;
  databaseName: string;
  migrationsDir: string;
  createDir: string;
}

export interface MongoWorkerRequest extends IsolatedMongoOptions {
  operation: MongoOperation;
  name?: string;
}

export interface MongoProcessObservation {
  operation: MongoOperation;
  databaseName: string;
  migrationsDir: string;
  pid: number | null;
  clientOpened: boolean;
  clientClosed: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  workerPath: string | null;
  commandNames: string[];
}

interface WorkerLifecycle {
  pid: number;
  clientOpened: boolean;
  clientClosed: boolean;
  workerPath: string;
  commandNames: string[];
}

export type MongoWorkerResult = CreateResult | DownResult | MigrationStatus[] | UpResult;

export type MongoWorkerResponse =
  | (WorkerLifecycle & { ok: true; result: MongoWorkerResult })
  | (WorkerLifecycle & {
      ok: false;
      error:
        | { kind: 'operation'; cause: SerializedMigrationError }
        | { kind: 'preflight'; operation: HistoryOperation; code: string; ids: string[]; cause: SerializedMigrationError }
        | { kind: 'uncertain'; operation: MutationOperation; completedIds: string[]; historyInspected: boolean; cause: SerializedMigrationError };
      cleanupError?: SerializedMigrationError;
    });
