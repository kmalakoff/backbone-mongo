import assert from 'assert';
import { deserializeMigrationError, type MigrationError, MigrationUncertainStateError, serializeMigrationError } from '../../../src/next/errors.ts';

describe('migration wave 2 error serialization', () => {
  it('roundtrips only the bounded migration and history-inspection details', () => {
    const cause: MigrationError & { ignored?: unknown } = new Error('runner failure');
    cause.name = 'RunnerMigrationError';
    cause.stack = 'runner stack';
    cause.migrated = ['202609090001_baseline.js'];
    cause.ignored = { arbitrary: true };
    const historyInspectionError = new Error('history read failed') as Error & { code?: string; ignored?: unknown };
    historyInspectionError.name = 'MongoNotConnectedError';
    historyInspectionError.stack = 'history stack';
    historyInspectionError.code = 'CLIENT_CLOSED';
    historyInspectionError.ignored = { arbitrary: true };
    cause.historyInspectionError = historyInspectionError;

    const serialized = serializeMigrationError(cause);
    assert.deepEqual(serialized, {
      name: 'RunnerMigrationError',
      message: 'runner failure',
      stack: 'runner stack',
      migrated: ['202609090001_baseline.js'],
      historyInspectionError: {
        name: 'MongoNotConnectedError',
        message: 'history read failed',
        stack: 'history stack',
      },
    });

    const restored = deserializeMigrationError(serialized);
    assert.equal(restored.name, cause.name);
    assert.equal(restored.message, cause.message);
    assert.equal(restored.stack, cause.stack);
    assert.deepEqual(restored.migrated, cause.migrated);
    assert.ok(restored.historyInspectionError instanceof Error);
    assert.equal(restored.historyInspectionError.name, historyInspectionError.name);
    assert.equal(restored.historyInspectionError.message, historyInspectionError.message);
    assert.equal(restored.historyInspectionError.stack, historyInspectionError.stack);
    assert.equal('ignored' in restored, false);
    assert.equal('code' in restored.historyInspectionError, false);
    assert.equal('ignored' in restored.historyInspectionError, false);
  });

  it('distinguishes a successful empty history read from unavailable history', () => {
    const inspected = new MigrationUncertainStateError('up', new Error('known empty'), [], true);
    const unavailableCause: MigrationError = new Error('history unavailable');
    unavailableCause.migrated = ['202609090001_baseline.js'];
    unavailableCause.historyInspectionError = new Error('client closed');
    const unavailable = new MigrationUncertainStateError('up', unavailableCause, [...unavailableCause.migrated], false);

    assert.equal(inspected.historyInspected, true);
    assert.deepEqual(inspected.completedIds, []);
    assert.equal(inspected.cause.historyInspectionError, undefined);
    assert.equal(unavailable.historyInspected, false);
    assert.deepEqual(unavailable.completedIds, ['202609090001_baseline.js']);
    assert.equal(unavailable.cause.historyInspectionError?.message, 'client closed');
  });
});
