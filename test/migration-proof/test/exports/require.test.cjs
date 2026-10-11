const assert = require('assert');
const { MigrationFacade, createMigrationWorker } = require('backbone-mongo-migration-proof');

describe('exports .cjs', () => {
  it('migration facade', () => {
    assert.equal(typeof MigrationFacade, 'function');
    assert.equal(typeof createMigrationWorker, 'function');
  });
});
