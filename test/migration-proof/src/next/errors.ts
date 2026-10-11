export type MutationOperation = 'up' | 'down';
export type HistoryOperation = MutationOperation | 'status';

export function historyIdentityIssue(files: readonly string[], historyIds: readonly string[]): { code: 'duplicate-history' | 'missing-applied-files'; ids: string[] } | undefined {
  const duplicates = [...new Set(historyIds.filter((id, index) => historyIds.indexOf(id) !== index))];
  if (duplicates.length > 0) return { code: 'duplicate-history', ids: duplicates };
  const fileIds = new Set(files);
  const missing = historyIds.filter((id) => !fileIds.has(id));
  if (missing.length > 0) return { code: 'missing-applied-files', ids: missing };
  return undefined;
}

export interface SerializedHistoryInspectionError {
  name: string;
  message: string;
  stack?: string;
}

export interface MigrationError extends Error {
  code?: string;
  path?: string;
  syscall?: string;
  historyInspectionError?: Error;
  migrated?: string[];
}

export interface SerializedMigrationError {
  code?: string;
  path?: string;
  syscall?: string;
  name: string;
  message: string;
  stack?: string;
  historyInspectionError?: SerializedHistoryInspectionError;
  migrated?: string[];
}

export class MongoHistoryPreflightError extends Error {
  readonly code: string;
  readonly ids: readonly string[];
  readonly operation: HistoryOperation;

  constructor(operation: HistoryOperation, code: string, ids: string[], message: string) {
    super(message);
    this.name = 'MongoHistoryPreflightError';
    this.operation = operation;
    this.code = code;
    this.ids = ids;
  }
}

export class MigrationUncertainStateError extends Error {
  readonly cause: MigrationError;
  readonly completedIds: readonly string[];
  readonly historyInspected: boolean;
  readonly operation: MutationOperation;
  readonly state = 'uncertain' as const;

  constructor(operation: MutationOperation, cause: MigrationError, completedIds: string[], historyInspected: boolean) {
    super(`Migration ${operation} failed after writes may have occurred: ${cause.message}`);
    this.name = 'MigrationUncertainStateError';
    this.cause = cause;
    this.operation = operation;
    this.completedIds = completedIds;
    this.historyInspected = historyInspected;
  }
}

function serializeHistoryInspectionError(error: unknown): SerializedHistoryInspectionError {
  const normalized = error instanceof Error ? error : new Error(String(error));
  return {
    name: normalized.name,
    message: normalized.message,
    ...(normalized.stack ? { stack: normalized.stack } : {}),
  };
}

export function serializeMigrationError(error: unknown): SerializedMigrationError {
  const normalized = (error instanceof Error ? error : new Error(String(error))) as MigrationError;
  const migrated = normalized.migrated;
  return {
    name: normalized.name,
    message: normalized.message,
    ...(normalized.stack ? { stack: normalized.stack } : {}),
    ...('code' in normalized && typeof normalized.code === 'string' ? { code: normalized.code } : {}),
    ...('path' in normalized && typeof normalized.path === 'string' ? { path: normalized.path } : {}),
    ...('syscall' in normalized && typeof normalized.syscall === 'string' ? { syscall: normalized.syscall } : {}),
    ...(Array.isArray(migrated) && migrated.every((value) => typeof value === 'string') ? { migrated } : {}),
    ...(normalized.historyInspectionError === undefined ? {} : { historyInspectionError: serializeHistoryInspectionError(normalized.historyInspectionError) }),
  };
}

export function deserializeMigrationError(serialized: SerializedMigrationError): MigrationError {
  const error: MigrationError = new Error(serialized.message);
  error.name = serialized.name;
  if (serialized.code !== undefined) error.code = serialized.code;
  if (serialized.path !== undefined) error.path = serialized.path;
  if (serialized.syscall !== undefined) error.syscall = serialized.syscall;
  if (serialized.stack) error.stack = serialized.stack;
  if (serialized.migrated) error.migrated = serialized.migrated;
  if (serialized.historyInspectionError) {
    const historyInspectionError = new Error(serialized.historyInspectionError.message);
    historyInspectionError.name = serialized.historyInspectionError.name;
    if (serialized.historyInspectionError.stack) historyInspectionError.stack = serialized.historyInspectionError.stack;
    error.historyInspectionError = historyInspectionError;
  }
  return error;
}
