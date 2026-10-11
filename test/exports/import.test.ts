import assert from 'assert';
import Mongo, { configure, sync } from 'backbone-mongo';

describe('tooling root export', () => {
  it('resolves the public factory', () => {
    assert.strictEqual(Mongo.sync, sync);
    assert.strictEqual(Mongo.configure, configure);
  });
});
