import assert from 'assert';
import { createMigrationWorker, type MigrationOperations } from 'backbone-mongo-migration-proof';

describe('migration worker', () => {
  it('reports synchronous invocation failures once without catching consumer callback errors', () => {
    const operationError = new Error('synchronous operation failure');
    const consumerError = new Error('consumer callback failure');
    const operations: MigrationOperations = {
      create(): Promise<never> {
        throw operationError;
      },
      status(): Promise<never> {
        throw operationError;
      },
      up(): Promise<never> {
        throw operationError;
      },
      down(): Promise<never> {
        throw operationError;
      },
    };
    const worker = createMigrationWorker(operations);
    const invocations = [(callback: (error: Error | null) => void) => worker.create('name', callback), (callback: (error: Error | null) => void) => worker.status(callback), (callback: (error: Error | null) => void) => worker.up(callback), (callback: (error: Error | null) => void) => worker.down(callback)];

    for (const invoke of invocations) {
      let calls = 0;
      assert.throws(
        () =>
          invoke((error) => {
            calls++;
            assert.equal(error, operationError);
            throw consumerError;
          }),
        consumerError
      );
      assert.equal(calls, 1);
    }
  });
});

describe('migration preparation callback parity', () => {
  it('retains original synchronous and Promise errors with one callback', async () => {
    const { MigrationPreparationFacade, createMigrationPreparationWorker } = await import('backbone-mongo-migration-proof');
    const original = new Error('original operation failure');
    const facade = new MigrationPreparationFacade(createMigrationPreparationWorker({
      create(): Promise<never> { throw original; },
      status() { return Promise.reject(original); },
    }));
    assert.equal('up' in facade, false);
    assert.equal('down' in facade, false);
    await assert.rejects(facade.create('failure'), (error: unknown) => error === original);
    await assert.rejects(facade.status(), (error: unknown) => error === original);
    for (const operation of [
      (callback: (error: Error | null) => void) => facade.create('failure', callback),
      (callback: (error: Error | null) => void) => facade.status(callback),
    ]) {
      let calls = 0;
      let returned: void = undefined;
      let observed: Error | null | undefined;
      await new Promise<void>((resolve) => {
        returned = operation((error) => {
          calls++;
          observed = error;
          setImmediate(resolve);
        });
      });
      assert.equal(returned, undefined);
      assert.equal(observed, original);
      assert.equal(calls, 1);
    }
  });
});
