import type { MigrationCallback, MigrationOperations, MigrationPreparationOperations, MigrationPreparationWorker, MigrationWorker } from './types.ts';

function complete<T>(start: () => Promise<T>, callback: MigrationCallback<T>): void {
  let operation: Promise<T>;
  try {
    operation = start();
  } catch (error) {
    callback(error instanceof Error ? error : new Error(String(error)));
    return;
  }
  operation.then(
    (result) => callback(null, result),
    (error: unknown) => callback(error instanceof Error ? error : new Error(String(error)))
  );
}

export function createMigrationPreparationWorker(operations: MigrationPreparationOperations): MigrationPreparationWorker {
  return {
    create(name, callback) {
      complete(() => operations.create(name), callback);
    },
    status(callback) {
      complete(() => operations.status(), callback);
    },
  };
}

export function createMigrationWorker(operations: MigrationOperations): MigrationWorker {
  return {
    ...createMigrationPreparationWorker(operations),
    up(callback) {
      complete(() => operations.up(), callback);
    },
    down(callback) {
      complete(() => operations.down(), callback);
    },
  };
}
