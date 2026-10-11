import assert from 'assert';
import { MongoClient } from 'mongodb';
import { resolveMongoTarget } from '../../../src/lib/target.ts';

describe('internal driver URI boundary', () => {
  it('passes SRV, IPv6 and host lists to the real driver parser with opaque keys', () => {
    for (const uri of ['mongodb+srv://user:p%40ss@example.com/db/items', 'mongodb://[::1]:27017/db/items', 'mongodb://host-a:27017,host-b:27018/db/items']) {
      const target = resolveMongoTarget(uri, {});
      assert.strictEqual(target.collection, 'items');
      assert.strictEqual(target.database, 'db');
      assert.match(target.key, /^backbone-mongo:[0-9a-f]{64}$/);
      assert.strictEqual(target.key.includes('p%40ss'), false);
      const client = new MongoClient(target.uri);
      assert.strictEqual(client.options.dbName, 'db');
    }
    assert.throws(
      () => resolveMongoTarget('mongodb://secret:password@host/db/items/extra', {}),
      (error: unknown) => error instanceof Error && !error.message.includes('password')
    );
  });
});
