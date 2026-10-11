import assert from 'assert';
import Mongo, { sync } from 'backbone-mongo';

describe('native ESM root export', () => {
  it('resolves the public factory', () => {
    assert.strictEqual(Mongo.sync, sync);
  });
});
