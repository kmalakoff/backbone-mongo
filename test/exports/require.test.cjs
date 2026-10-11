const assert = require('assert');
const Mongo = require('backbone-mongo');
describe('native CJS root export', () => {
  it('resolves the public factory', () => {
    assert.strictEqual(Mongo.default.sync, Mongo.sync);
  });
});
