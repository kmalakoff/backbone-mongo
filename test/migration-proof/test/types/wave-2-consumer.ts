import type { MigrationFacade, UpResult } from '../../src/index.ts';
import type { MigrationUncertainStateError } from '../../src/next/errors.ts';
import type { createIsolatedMongoFacade } from '../../src/next/isolated-mongo.ts';

export function consumeIsolatedFacade(facade: MigrationFacade): void {
  const promise: Promise<UpResult> = facade.up();
  const callbackReturn: void = facade.up((_error, result) => {
    result?.applied.map((id) => id.toUpperCase());
  });
  // @ts-expect-error The callback form omits a Promise and returns void.
  const invalidPromise: Promise<UpResult> = facade.up(() => undefined);
  void [promise, callbackReturn, invalidPromise];
}

export function consumeUncertainError(error: MigrationUncertainStateError): void {
  const operation: 'up' | 'down' = error.operation;
  const completedIds: readonly string[] = error.completedIds;
  const historyInspected: boolean = error.historyInspected;
  const state: 'uncertain' = error.state;
  const migrated: string[] | undefined = error.cause.migrated;
  const historyInspectionError: Error | undefined = error.cause.historyInspectionError;
  void [operation, completedIds, historyInspected, state, migrated, historyInspectionError];
}

export type IsolatedFacadeFactory = typeof createIsolatedMongoFacade;
