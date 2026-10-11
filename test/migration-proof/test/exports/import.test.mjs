import assert from 'assert';
import { createMigrationWorker, MigrationFacade } from 'backbone-mongo-migration-proof';

describe('exports .mjs', () => {
  it('migration facade', () => {
    assert.equal(typeof MigrationFacade, 'function');
    assert.equal(typeof createMigrationWorker, 'function');
  });
});
