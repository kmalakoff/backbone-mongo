import assert from 'assert';
import Backbone from 'backbone';
import Mongo from 'backbone-mongo';
import ORM from 'backbone-orm';
import { ObjectId } from 'mongodb';
import { collection, connection, fetch, save } from './public.ts';

export async function exerciseMongoCrud(uri: string): Promise<void> {
  assert.strictEqual(Mongo.Backbone, Backbone);
  assert.strictEqual(ORM.Backbone, Backbone);
  assert.strictEqual(Mongo._, ORM._);
  class Item extends Backbone.Model {
    urlRoot = `${uri}/items`;
  }
  Item.prototype.sync = Mongo.sync(Item);
  const control = connection(Item);
  try {
    const input = { name: 'alpha', remove: 'retained', nested: { number: 1 } };
    const alpha = new Item(input);
    await save(alpha);
    assert.strictEqual(alpha.get('_rev'), 1);
    assert.strictEqual(typeof alpha.id, 'string');
    if (typeof alpha.id !== 'string') throw new Error('Default id was not a string');
    assert.match(alpha.id, /^[0-9a-f]{24}$/);
    assert.deepStrictEqual(input, { name: 'alpha', remove: 'retained', nested: { number: 1 } });
    const native = await collection(control);
    const stored = await native.findOne({ _id: new ObjectId(alpha.id) });
    assert.ok(stored?._id instanceof ObjectId);
    assert.strictEqual(stored.id, undefined);
    assert.strictEqual(stored._rev, 1);

    const stale = new Item({ id: alpha.id });
    await fetch(stale);
    await save(alpha, { name: 'updated' });
    assert.strictEqual(alpha.get('_rev'), 2);
    stale.unset('remove');
    await assert.rejects(save(stale, { name: 'stale' }), /revision \(_rev\) was stale/);
    assert.strictEqual(stale.get('_rev'), 1);
    assert.strictEqual((await native.findOne({ _id: new ObjectId(alpha.id) }))?.remove, 'retained');
    stale.set('_rev', 2);
    await save(stale, { name: 'retried' });
    assert.strictEqual(stale.get('_rev'), 3);
    assert.strictEqual((await native.findOne({ _id: new ObjectId(alpha.id) }))?.remove, undefined);
    const invalid = new Item({ id: 'not-an-object-id' });
    await assert.rejects(fetch(invalid), /Invalid default Mongo id/);

    await new Promise<void>((resolve, reject) => {
      const returned: unknown = stale.destroy({ success: () => resolve(), error: (_model, error: unknown) => reject(error) });
      assert.strictEqual(returned, undefined);
    });
    assert.strictEqual(await native.countDocuments(), 0);
  } finally {
    await control.destroy();
  }
  assert.strictEqual(ORM.ConnectionPool.get(control.url), undefined);
}
