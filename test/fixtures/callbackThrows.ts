import { inspect } from 'node:util';
import assert from 'assert';
import Mongo from 'backbone-mongo';
import { MongoClient } from 'mongodb';
import { call, collection, connection, save } from '../lib/public.ts';

const [uri, mode] = process.argv.slice(2);
class CallbackItem extends Mongo.Backbone.Model {
  urlRoot = `${uri}/callback_items`;
}
CallbackItem.prototype.sync = Mongo.sync(CallbackItem);
const control = connection(CallbackItem);
const controls = [control];
const failure = new Error('customer callback threw');
let notifications = 0;
let verifyRows: (() => Promise<void>) | undefined;
let verifierClient: MongoClient | undefined;
process.once('uncaughtException', (error) => {
  void (async () => {
    const errors: unknown[] = [];
    if (error !== failure) errors.push(error);
    try {
      assert.strictEqual(error, failure);
      console.error('Callback fixture verification entry:', mode);
      await verifyRows?.();
    } catch (error: unknown) {
      errors.push(error);
    } finally {
      try {
        console.error('Callback fixture controls cleanup entry:', mode);
        const closed = await Promise.allSettled(controls.map(async (owned) => owned.destroy()));
        errors.push(...closed.filter((entry) => entry.status === 'rejected').map((entry) => entry.reason));
      } catch (error: unknown) {
        errors.push(error);
      }
      if (verifierClient) {
        try {
          console.error('Callback fixture verifier cleanup entry:', mode);
          await verifierClient.close();
        } catch (error: unknown) {
          errors.push(error);
        }
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, 'Callback fixture operation/cleanup failed');
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(notifications, 1);
    process.stdout.write('callback throw escaped once; connection cleanup confirmed\n');
  })().catch((error: unknown) => {
    console.error('Callback fixture failure:', inspect({ mode, notifications, error }, { depth: null, maxArrayLength: null, maxStringLength: null, colors: false }));
    process.exitCode = 1;
  });
});
function notified(): never {
  notifications += 1;
  throw failure;
}
if (mode === 'relationInclude' || mode === 'relationIncludeError') {
  class Parent extends Mongo.Backbone.Model {
    static model_name = 'Parent';
    urlRoot = `${uri}/callback_${mode}_parents`;
    schema() {
      return { children: ['hasMany', Child, { as: 'parent' }] };
    }
  }
  class Child extends Mongo.Backbone.Model {
    static model_name = 'Child';
    urlRoot = `${uri}/callback_${mode}_children`;
    schema() {
      return { parent: ['belongsTo', Parent, { as: 'children' }] };
    }
  }
  Parent.prototype.sync = Mongo.sync(Parent);
  Child.prototype.sync = Mongo.sync(Child);
  const parentControl = connection(Parent);
  const childControl = connection(Child);
  controls.push(parentControl, childControl);
  const parent = new Parent({ name: 'parent' });
  await save(parent);
  await save(new Child({ name: 'child', parent }));
  if (mode === 'relationIncludeError') await childControl.destroy();
  const cursor = call(Parent, 'cursor', [{ id: parent.id, $include: ['children'] }]);
  assert.ok(typeof cursor === 'object' && cursor !== null);
  call(cursor, 'toJSON', [
    (error: unknown, value: unknown) => {
      if (mode === 'relationIncludeError') assert.ok(error instanceof Error);
      else {
        assert.strictEqual(error, null);
        assert.ok(Array.isArray(value));
      }
      notified();
    },
  ]);
} else if (mode === 'staticDestroy' || mode === 'staticDestroyError') {
  class StaticItem extends Mongo.Backbone.Model {
    urlRoot = `${uri}/callback_${mode}_items`;
  }
  StaticItem.prototype.sync = Mongo.sync(StaticItem);
  const staticControl = connection(StaticItem);
  controls.push(staticControl);
  const item = new StaticItem({ name: 'selected' });
  await save(item);
  const native = await collection(staticControl);
  const before = await native.find({}).toArray();
  verifyRows = async () => {
    assert.deepStrictEqual(await native.find({}).toArray(), mode === 'staticDestroy' ? [] : before);
  };
  let returnedToCaller = false;
  const returned = call(StaticItem, 'destroy', [{ id: mode === 'staticDestroy' ? item.id : 'invalid' }, (...args: unknown[]) => {
    assert.strictEqual(returnedToCaller, true);
    if (mode === 'staticDestroy') assert.deepStrictEqual(args, [null, 1]);
    else {
      assert.strictEqual(args.length, 1);
      assert.ok(args[0] instanceof Error);
    }
    notified();
  }]);
  assert.strictEqual(returned, undefined);
  returnedToCaller = true;
} else if (mode === 'dropTable' || mode === 'dropTableError' || mode === 'ensureIndex' || mode === 'ensureIndexError' || mode === 'createOrUpdateTable' || mode === 'createOrUpdateTableError') {
  const method = mode.startsWith('dropTable') ? 'dropTable' : mode.startsWith('ensureIndex') ? 'ensureIndex' : 'createOrUpdateTable';
  const isError = mode.endsWith('Error');
  const table = `callback_${mode}_items`;
  class DatabaseItem extends Mongo.Backbone.Model {
    urlRoot = `${uri}/${table}`;
    schema() {
      return { id: ['Integer', { indexed: true }], name: ['String', { indexed: true }] };
    }
  }
  DatabaseItem.prototype.sync = Mongo.sync(DatabaseItem);
  const databaseControl = connection(DatabaseItem);
  controls.push(databaseControl);
  await save(new DatabaseItem({ name: 'survivor' }));
  verifierClient = new MongoClient(uri);
  await verifierClient.connect();
  const native = verifierClient.db('production_port').collection(table);
  await native.createIndex({ sentinel: -1 }, { name: 'retained_custom' });
  let conflictCode: unknown;
  if (isError && method !== 'dropTable') {
    await native.createIndex({ name: 1 }, { unique: true });
    const original = await native.createIndex({ name: 1 }, { background: true }).then(() => undefined, (error: unknown) => error);
    assert.ok(original instanceof Error);
    conflictCode = Reflect.get(original, 'code');
    assert.strictEqual(typeof conflictCode, 'number');
  }
  const before = await native.find({}).toArray();
  const indexes = await native.listIndexes().toArray();
  const namespaces = await verifierClient.db('production_port').listCollections({ name: table }).toArray();
  verifyRows = async () => {
    assert.deepStrictEqual(await native.find({}).toArray(), method === 'dropTable' && !isError ? [] : before);
    assert.ok(verifierClient);
    assert.deepStrictEqual(await verifierClient.db('production_port').listCollections({ name: table }).toArray(), namespaces);
    const after = await native.listIndexes().toArray();
    for (const index of indexes) assert.deepStrictEqual(after.find((entry) => entry.name === index.name), index);
    if (!isError && method !== 'dropTable') assert.deepStrictEqual(after.find((index) => index.name === 'name_1')?.key, { name: 1 });
    if (!isError && method === 'createOrUpdateTable') assert.deepStrictEqual(after.find((index) => index.name === 'id_1')?.key, { id: 1 });
  };
  if (isError && method === 'dropTable') await databaseControl.destroy();
  const db = call(DatabaseItem, 'db');
  assert.ok(typeof db === 'object' && db !== null);
  let returnedToCaller = false;
  const args: unknown[] = method === 'ensureIndex' ? ['name'] : method === 'createOrUpdateTable' ? [{}] : [];
  const returned = call(db, method, [...args, (...values: unknown[]) => {
    console.error('Database callback actual values:', inspect({ mode, values }, { depth: null, maxArrayLength: null, maxStringLength: null, colors: false }));
    assert.strictEqual(returnedToCaller, true);
    if (isError) {
      assert.strictEqual(values.length, 1);
      assert.ok(values[0] instanceof Error);
      if (method === 'dropTable') assert.match(values[0].message, /connection is closed/);
      else {
        assert.strictEqual(values[0].message, 'Mongo ensureIndex failed');
        assert.strictEqual(Reflect.get(values[0], 'code'), conflictCode);
        assert.strictEqual(Reflect.get(values[0], 'cause'), undefined);
      }
    } else assert.deepStrictEqual(values, method === 'ensureIndex' ? [] : [null]);
    notified();
  }]);
  assert.strictEqual(returned, undefined);
  returnedToCaller = true;
} else if (mode === 'ensureSchema' || mode === 'ensureSchemaError' || mode === 'resetSchema' || mode === 'resetSchemaError') {
  const method = mode.startsWith('ensureSchema') ? 'ensureSchema' : 'resetSchema';
  const isError = mode.endsWith('Error');
  const table = `callback_${mode}_items`;
  class DatabaseItem extends Mongo.Backbone.Model {
    urlRoot = `${uri}/${table}`;
    schema() {
      return { id: ['Integer', { indexed: true }], name: ['String', { indexed: true }] };
    }
  }
  DatabaseItem.prototype.sync = Mongo.sync(DatabaseItem);
  const databaseControl = connection(DatabaseItem);
  controls.push(databaseControl);
  verifierClient = new MongoClient(uri);
  await verifierClient.connect();
  const database = verifierClient.db('production_port');
  const native = await database.createCollection(table, { validator: { name: { $type: 'string' } }, validationLevel: 'strict' });
  await native.createIndex({ sentinel: -1 }, { name: 'retained_custom' });
  await save(new DatabaseItem({ name: 'survivor' }));
  let conflictCode: unknown;
  if (isError) {
    await native.createIndex({ name: 1 }, { unique: true });
    const original = await native.createIndex({ name: 1 }, { background: true }).then(() => undefined, (error: unknown) => error);
    assert.ok(original instanceof Error);
    conflictCode = Reflect.get(original, 'code');
    assert.strictEqual(conflictCode, 86);
  }
  const before = await native.find({}).toArray();
  assert.deepStrictEqual(before.map(({ name, _rev }) => ({ name, _rev })), [{ name: 'survivor', _rev: 1 }]);
  const indexes = await native.listIndexes().toArray();
  const namespaces = await database.listCollections({ name: table }).toArray();
  assert.ok(namespaces[0]?.info?.uuid);
  verifyRows = async () => {
    assert.deepStrictEqual(await native.find({}).toArray(), method === 'resetSchema' ? [] : before);
    assert.deepStrictEqual(await database.listCollections({ name: table }).toArray(), namespaces);
    const after = await native.listIndexes().toArray();
    for (const index of indexes) assert.deepStrictEqual(after.find((entry) => entry.name === index.name), index);
    if (!isError) {
      assert.deepStrictEqual(after.find((entry) => entry.name === 'id_1')?.key, { id: 1 });
      assert.deepStrictEqual(after.find((entry) => entry.name === 'name_1')?.key, { name: 1 });
    }
  };
  const db = call(DatabaseItem, 'db');
  assert.ok(typeof db === 'object' && db !== null);
  let returnedToCaller = false;
  const returned = call(db, method, [{}, (...values: unknown[]) => {
    console.error('Database callback actual values:', inspect({ mode, values }, { depth: null, maxArrayLength: null, maxStringLength: null, colors: false }));
    assert.strictEqual(returnedToCaller, true);
    if (isError) {
      assert.strictEqual(values.length, 1);
      assert.ok(values[0] instanceof Error);
      assert.strictEqual(values[0].message, 'Mongo ensureIndex failed');
      assert.strictEqual(Reflect.get(values[0], 'code'), conflictCode);
      assert.strictEqual(Reflect.get(values[0], 'cause'), undefined);
    } else assert.deepStrictEqual(values, [null]);
    notified();
  }]);
  assert.strictEqual(returned, undefined);
  returnedToCaller = true;
} else if (mode === 'collectionError') {
  await control.destroy();
  control.collection((error) => {
    assert.ok(error);
    notified();
  });
} else if (mode === 'collection') {
  control.collection((error, value) => {
    assert.strictEqual(error, null);
    assert.ok(value);
    notified();
  });
} else if (mode === 'create') {
  new CallbackItem({ name: 'child' }).save(null, {
    success: notified,
    error: (_model, error: unknown) => {
      throw error;
    },
  });
} else if (mode === 'createError') {
  await collection(control);
  new CallbackItem({ id: 'invalid' }).save(null, {
    success: () => {
      throw new Error('Invalid create unexpectedly passed');
    },
    error: notified,
  });
} else throw new Error('Unknown callback fixture mode');
