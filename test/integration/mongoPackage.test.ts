// Owns one real loopback MongoDB server; no shared service or user database is used.

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { inspect } from 'node:util';
import assert from 'assert';
import Backbone from 'backbone';
import Mongo, { type MongoConnectionControl } from 'backbone-mongo';
import ORM, { type CursorInstance } from 'backbone-orm';
import { type CommandFailedEvent, type CommandStartedEvent, type CommandSucceededEvent, MongoClient, ObjectId } from 'mongodb';
import { repository, startMongo } from '../lib/mongo.ts';
import { exerciseMongoCrud } from '../lib/mongoCrud.ts';
import { runOwnedProcess } from '../lib/process.ts';
import { call, collection, connection, fetch, result, save } from '../lib/public.ts';

interface MaterializedAttributes {
  id?: number | string;
  name?: string;
  _rev?: number;
}

function publicCursor(type: object, query: unknown): CursorInstance {
  const cursor = call(type, 'cursor', [query]);
  assert.ok(cursor instanceof ORM.Cursor);
  return cursor;
}

async function findModels(type: object, query: unknown): Promise<Backbone.Model[]> {
  const request = call(type, 'find', [query]);
  assert.ok(request instanceof Promise, 'Public find without a callback must return a Promise');
  const models: unknown = await request;
  assert.ok(Array.isArray(models));
  return models.map((model: unknown) => {
    assert.ok(model instanceof Backbone.Model);
    return model;
  });
}

async function materialize<M extends Backbone.Model>(cursor: CursorInstance<M>): Promise<M[]> {
  let notifications = 0;
  const models = await new Promise<M[]>((resolve, reject) => {
    const returned = cursor.toModels((error, value) => {
      notifications += 1;
      if (error) reject(error);
      else if (!Array.isArray(value)) reject(new Error('Expected public cursor model array'));
      else resolve(value);
    });
    assert.strictEqual(returned, undefined);
  });
  assert.strictEqual(notifications, 1);
  return models;
}

async function queryJSON(type: object, query: unknown): Promise<unknown> {
  const cursor = publicCursor(type, query);
  let notifications = 0;
  try {
    return await result((callback) =>
      cursor.toJSON((error, value) => {
        notifications += 1;
        callback(error, value);
      })
    );
  } finally {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(notifications, 1, 'Public query callback must notify once');
  }
}

async function queryNames(type: object, query: unknown): Promise<string[]> {
  const rows = await queryJSON(type, query);
  assert.ok(Array.isArray(rows));
  return rows.map((row: unknown) => {
    assert.ok(typeof row === 'object' && row !== null);
    const name: unknown = Reflect.get(row, 'name');
    assert.ok(typeof name === 'string');
    return name;
  });
}

async function schemaOutcome(host: object, method: 'ensureSchema' | 'resetSchema', options?: unknown): Promise<unknown[]> {
  let notifications = 0;
  let returnedToCaller = false;
  let asynchronous = false;
  const values = await new Promise<unknown[]>((resolve) => {
    const notify = (...args: unknown[]) => {
      notifications++;
      asynchronous = returnedToCaller;
      resolve(args);
    };
    const returned = call(host, method, options === undefined ? [notify] : [options, notify]);
    assert.strictEqual(returned, undefined);
    returnedToCaller = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.strictEqual(notifications, 1);
  assert.strictEqual(asynchronous, true);
  return values;
}

describe('public flat Mongo production slice', () => {
  let server: Awaited<ReturnType<typeof startMongo>>;
  before(async () => {
    server = await startMongo();
  });
  after(async () => {
    try {
      await ORM.ConnectionPool.disposeAll();
    } finally {
      if (server) {
        await server.close();
        assert.strictEqual(existsSync(server.root), false);
      }
    }
  });

  it('keeps the canonical cached child revision current after hasMany removal and permits its next save', async () => {
    const prefix = 'hasmany_removal_cache_revision';
    const controls: MongoConnectionControl[] = [];
    let parentControl: MongoConnectionControl | undefined;
    let childControl: MongoConnectionControl | undefined;
    let failed = false;
    let failure: unknown;
    const cleanupErrors: unknown[] = [];
    class Parent extends Backbone.Model {
      static model_name = 'Parent';
      urlRoot = `${server.uri}/${prefix}_parents`;
      schema() {
        return {
          bootstrap: () => {
            parentControl = connection(Parent);
            controls.push(parentControl);
            return 'String';
          },
          children: ['hasMany', Child, { as: 'parent' }],
        };
      }
    }
    class Child extends Backbone.Model {
      static model_name = 'Child';
      urlRoot = `${server.uri}/${prefix}_children`;
      schema() {
        return {
          bootstrap: () => {
            childControl = connection(Child);
            controls.push(childControl);
            return 'String';
          },
          parent: ['belongsTo', Parent, { as: 'children' }],
        };
      }
    }
    try {
      ORM.configure({ model_cache: { enabled: true, max: 100 } });
      Parent.prototype.sync = Mongo.sync(Parent);
      Child.prototype.sync = Mongo.sync(Child);
      assert.ok(parentControl && childControl);
      assert.strictEqual(controls.length, 2);
      const relation = call(Child, 'relation', ['parent']);
      assert.ok(typeof relation === 'object' && relation !== null);
      const foreignKey: unknown = Reflect.get(relation, 'foreign_key');
      assert.ok(typeof foreignKey === 'string');
      const parentNative = await collection(parentControl);
      const childNative = await collection(childControl);
      const parent = new Parent({ name: 'parent' });
      const other = new Parent({ name: 'other' });
      await save(parent);
      await save(other);
      const child = new Child({ name: 'linked', parent });
      const survivor = new Child({ name: 'survivor', parent: other });
      await save(child);
      await save(survivor);
      const before = await childNative.findOne({ _id: new ObjectId(String(child.id)) });
      const survivorBefore = await childNative.findOne({ _id: new ObjectId(String(survivor.id)) });
      const otherBefore = await parentNative.findOne({ _id: new ObjectId(String(other.id)) });
      assert.ok(before && survivorBefore && otherBefore);
      assert.strictEqual(before._rev, 1);
      assert.strictEqual(before[foreignKey], parent.id);
      const cache: unknown = Reflect.get(Child, 'cache');
      assert.ok(typeof cache === 'object' && cache !== null);
      assert.strictEqual(call(cache, 'get', [child.id]), child);
      parent.set('children', []);
      await save(parent);

      const detached = await childNative.findOne({ _id: new ObjectId(String(child.id)) });
      assert.ok(detached && detached._id instanceof ObjectId);
      assert.strictEqual(detached[foreignKey], null);
      assert.strictEqual(detached._rev, 2);
      assert.strictEqual(detached.name, 'linked');
      assert.strictEqual(parent.get('_rev'), 2);
      const canonical = call(cache, 'get', [child.id]);
      assert.strictEqual(canonical, child);
      assert.ok(canonical instanceof Child);
      const cachedRevision: unknown = canonical.get('_rev');
      const cachedParent: unknown = canonical.get('parent');
      let followUpFailed = false;
      let followUpFailure: unknown;
      try {
        await save(canonical, { name: 'resaved detached' });
      } catch (error: unknown) {
        followUpFailed = true;
        followUpFailure = error;
      }
      const afterFollowUp = await childNative.findOne({ _id: new ObjectId(String(child.id)) });
      assert.ok(afterFollowUp);
      assert.deepStrictEqual(await childNative.findOne({ _id: new ObjectId(String(survivor.id)) }), survivorBefore);
      assert.deepStrictEqual(await parentNative.findOne({ _id: new ObjectId(String(other.id)) }), otherBefore);
      assert.strictEqual(await childNative.countDocuments(), 2);
      assert.strictEqual(await parentNative.countDocuments(), 2);
      assert.strictEqual(cachedRevision, detached._rev, `Canonical revision after removal; follow-up save: ${followUpFailed ? String(followUpFailure) : 'success'}; native revision after follow-up: ${afterFollowUp._rev}`);
      assert.strictEqual(cachedParent, null);
      if (followUpFailed) throw followUpFailure;
      assert.strictEqual(afterFollowUp._rev, 3);
      assert.strictEqual(afterFollowUp[foreignKey], null);
      assert.strictEqual(afterFollowUp.name, 'resaved detached');
      assert.strictEqual(canonical.get('_rev'), 3);
      assert.strictEqual(call(cache, 'get', [child.id]), canonical);
    } catch (error: unknown) {
      failed = true;
      failure = error;
    } finally {
      for (const control of controls) {
        try {
          await control.destroy();
          await assert.rejects(collection(control), /closed/);
        } catch (error: unknown) {
          cleanupErrors.push(error);
        }
      }
      try {
        ORM.configure({ model_cache: { enabled: false } });
      } catch (error: unknown) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length) throw new AggregateError(failed ? [failure, ...cleanupErrors] : cleanupErrors, 'HasMany cached revision operation/cleanup failed');
    if (failed) throw failure;
  });

  for (const enabled of [false, true]) {
    for (const [phase, behavior] of [
      ['save', 'saves persisted references and separates lazy getter return from callback'],
      ['includes', 'includes scalar/null profiles before projection and materializes cache identity'],
      ['replacement', 'replaces and explicitly removes a profile with canonical revisions and same-instance follow-up saves'],
      ['null', 'requires final-save null persistence and current canonical revisions before same-instance saves'],
      ['cas', 'notifies once for stale parent CAS and sanitized native profile errors while rows survive'],
      ['generated', 'uses the ORM-generated belongsTo inverse with the same public FK codec'],
    ] as const) {
      it(`bounded hasOne ${behavior} (cache=${enabled})`, async () => {
        const prefix = `hasone_${enabled ? 'on' : 'off'}_${phase}`;
        const controls: MongoConnectionControl[] = [];
        let parentControl: MongoConnectionControl | undefined;
        let profileControl: MongoConnectionControl | undefined;
        let failed = false;
        let failure: unknown;
        const cleanupErrors: unknown[] = [];
        class Parent extends Backbone.Model {
          static model_name = 'Parent';
          urlRoot = `${server.uri}/${prefix}_parents`;
          schema() {
            return {
              bootstrap: () => {
                parentControl = connection(Parent);
                controls.push(parentControl);
                return 'String';
              },
              profile: ['hasOne', Profile, { as: 'parent' }],
            };
          }
        }
        class Profile extends Backbone.Model {
          static model_name = 'Profile';
          urlRoot = `${server.uri}/${prefix}_profiles`;
          schema() {
            return {
              bootstrap: () => {
                profileControl = connection(Profile);
                controls.push(profileControl);
                return 'String';
              },
              ...(phase === 'generated' ? {} : { parent: ['belongsTo', Parent, { as: 'profile' }] }),
            };
          }
        }
        try {
          ORM.configure({ model_cache: { enabled, max: 100 } });
          Parent.prototype.sync = Mongo.sync(Parent);
          Profile.prototype.sync = Mongo.sync(Profile);
          assert.ok(parentControl && profileControl);
          assert.strictEqual(controls.length, 2);
          const declaredRelation = call(Parent, 'relation', ['profile']);
          const inverseRelation = call(Profile, 'relation', ['parent']);
          assert.ok(typeof declaredRelation === 'object' && declaredRelation !== null);
          assert.ok(typeof inverseRelation === 'object' && inverseRelation !== null);
          assert.strictEqual(Reflect.get(declaredRelation, 'type'), 'hasOne');
          assert.strictEqual(Reflect.get(inverseRelation, 'type'), 'belongsTo');
          assert.strictEqual(Reflect.get(inverseRelation, 'foreign_key'), 'parent_id');
          assert.strictEqual(Reflect.get(declaredRelation, 'reverse_relation'), inverseRelation);
          assert.strictEqual(Reflect.get(inverseRelation, 'reverse_relation'), declaredRelation);
          const profileCache: unknown = Reflect.get(Profile, 'cache');
          if (enabled) assert.ok(typeof profileCache === 'object' && profileCache !== null);
          const parentNative = await collection(parentControl);
          const profileNative = await collection(profileControl);
          const parent = new Parent({ name: 'parent' });
          const empty = new Parent({ name: 'empty' });
          const unrelated = new Parent({ name: 'unrelated' });
          await save(parent);
          await save(empty);
          await save(unrelated);
          const current = new Profile({ name: 'current' });
          const replacement = new Profile({ name: 'replacement' });
          const survivor = new Profile({ name: 'survivor', parent: unrelated });
          await save(current);
          await save(replacement);
          await save(survivor);
          const survivorBefore = await profileNative.findOne({ _id: new ObjectId(String(survivor.id)) });
          const unrelatedBefore = await parentNative.findOne({ _id: new ObjectId(String(unrelated.id)) });
          assert.ok(survivorBefore && unrelatedBefore);
          parent.set('profile', current);
          let saveNotifications = 0;
          await result((callback) =>
            call(parent, 'save', [
              null,
              {
                success(model: unknown) {
                  saveNotifications += 1;
                  callback(null, model);
                },
                error(_model: unknown, error: unknown) {
                  saveNotifications += 1;
                  callback(error);
                },
              },
            ])
          );
          await new Promise<void>((resolve) => setImmediate(resolve));
          assert.strictEqual(saveNotifications, 1);
          const parentRow = await parentNative.findOne({ _id: new ObjectId(String(parent.id)) });
          const currentRow = await profileNative.findOne({ _id: new ObjectId(String(current.id)) });
          assert.ok(parentRow && currentRow);
          assert.ok(parentRow._id instanceof ObjectId && currentRow._id instanceof ObjectId);
          assert.strictEqual(parentRow._rev, 2);
          assert.strictEqual(parentRow.profile, undefined);
          assert.strictEqual(parentRow.profile_id, undefined);
          assert.strictEqual(currentRow.parent_id, parent.id);
          assert.strictEqual(typeof currentRow.parent_id, 'string');
          assert.strictEqual(currentRow._rev, 2);
          assert.strictEqual(current.get('_rev'), 2);
          assert.strictEqual(parent.get('_rev'), 2);
          if (enabled) {
            assert.ok(typeof profileCache === 'object' && profileCache !== null);
            assert.strictEqual(call(profileCache, 'get', [current.id]), current);
          }
          assert.strictEqual(current.get('parent'), parent);
          assert.strictEqual(parent.get('profile'), current);

          if (phase === 'save') {
            const fresh = new Parent({ id: parent.id });
            await fetch(fresh);
            assert.strictEqual(fresh.get('profile'), null);
            let notifications = 0;
            let returned: unknown;
            const loaded = await result((callback) => {
              returned = call(fresh, 'get', [
                'profile',
                (error: unknown, value?: unknown) => {
                  notifications += 1;
                  callback(error, value);
                },
              ]);
            });
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.strictEqual(notifications, 1);
            assert.strictEqual(returned, null, 'An unloaded One getter returns its pre-fetch value');
            assert.ok(loaded instanceof Profile);
            assert.strictEqual(loaded.id, current.id);
            assert.strictEqual(fresh.get('profile'), loaded);
            let loadedNotifications = 0;
            let loadedReturn: unknown;
            const loadedAgain = await result((callback) => {
              loadedReturn = call(fresh, 'get', [
                'profile',
                (error: unknown, value?: unknown) => {
                  loadedNotifications += 1;
                  callback(error, value);
                },
              ]);
            });
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.strictEqual(loadedNotifications, 1);
            assert.strictEqual(loadedReturn, loaded);
            assert.strictEqual(loadedAgain, loaded);
          } else if (phase === 'includes') {
            const query = Object.freeze({ id: parent.id, $include: Object.freeze(['profile']), $select: Object.freeze(['name', 'profile']) });
            const projected = await queryJSON(Parent, query);
            assert.ok(Array.isArray(projected));
            assert.strictEqual(projected.length, 1);
            assert.deepStrictEqual(projected, [{ name: 'parent', profile: { id: current.id, name: 'current', parent_id: parent.id, _rev: 2 } }]);
            const scalar = await queryJSON(Parent, { id: parent.id, $one: true, $include: ['profile'] });
            assert.ok(typeof scalar === 'object' && scalar !== null);
            const profile: unknown = Reflect.get(scalar, 'profile');
            assert.ok(typeof profile === 'object' && profile !== null && !Array.isArray(profile));
            assert.strictEqual(Reflect.get(profile, 'id'), current.id);
            const emptyJSON = await queryJSON(Parent, { id: empty.id, $one: true, $include: ['profile'] });
            assert.ok(typeof emptyJSON === 'object' && emptyJSON !== null);
            assert.strictEqual(Reflect.get(emptyJSON, 'profile'), null);
            const inverse = await queryJSON(Profile, { id: current.id, $one: true, $include: ['parent'] });
            assert.ok(typeof inverse === 'object' && inverse !== null);
            const inverseParent: unknown = Reflect.get(inverse, 'parent');
            assert.ok(typeof inverseParent === 'object' && inverseParent !== null);
            assert.strictEqual(Reflect.get(inverseParent, 'id'), parent.id);
            const orphan = await queryJSON(Profile, { id: replacement.id, $one: true, $include: ['parent'] });
            assert.ok(typeof orphan === 'object' && orphan !== null);
            assert.strictEqual(Reflect.get(orphan, 'parent'), null);
            const models = await materialize(publicCursor(Parent, { id: parent.id, $include: ['profile'] }));
            const repeated = await materialize(publicCursor(Parent, { id: parent.id, $include: ['profile'] }));
            assert.strictEqual(models.length, 1);
            const related = models[0].get('profile');
            assert.ok(related instanceof Profile);
            assert.strictEqual(related.id, current.id);
            if (enabled) {
              assert.strictEqual(models[0], parent);
              assert.strictEqual(related, current);
              assert.strictEqual(repeated[0], models[0]);
              assert.strictEqual(repeated[0].get('profile'), related);
            }
            assert.deepStrictEqual(query, { id: parent.id, $include: ['profile'], $select: ['name', 'profile'] });
            await assert.rejects(queryJSON(Parent, { $include: ['profile.parent'] }));
            await assert.rejects(queryJSON(Parent, { 'profile.name': 'current' }));
          } else if (phase === 'replacement') {
            parent.set('profile', replacement);
            await save(parent);
            const removed = await profileNative.findOne({ _id: new ObjectId(String(current.id)) });
            const added = await profileNative.findOne({ _id: new ObjectId(String(replacement.id)) });
            assert.ok(removed && added);
            assert.strictEqual(removed.parent_id, null);
            assert.strictEqual(removed._rev, 3);
            assert.strictEqual(removed.name, 'current');
            assert.strictEqual(added.parent_id, parent.id);
            assert.strictEqual(added._rev, 2);
            assert.strictEqual(parent.get('_rev'), 3);
            assert.strictEqual(await profileNative.countDocuments({ parent_id: parent.id }), 1);
            const included = await queryJSON(Parent, { id: parent.id, $one: true, $include: ['profile'] });
            assert.ok(typeof included === 'object' && included !== null);
            const related: unknown = Reflect.get(included, 'profile');
            assert.ok(typeof related === 'object' && related !== null);
            assert.strictEqual(Reflect.get(related, 'id'), replacement.id);
            let notifications = 0;
            await result((callback) =>
              call(parent, 'patchRemove', [
                'profile',
                (error: unknown, value?: unknown) => {
                  notifications += 1;
                  callback(error, value);
                },
              ])
            );
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.strictEqual(notifications, 1);
            const cleared = await profileNative.findOne({ _id: new ObjectId(String(replacement.id)) });
            assert.ok(cleared);
            assert.strictEqual(cleared.parent_id, null);
            assert.strictEqual(cleared._rev, 3);
            assert.strictEqual(cleared.name, 'replacement');
            assert.deepStrictEqual(await profileNative.findOne({ _id: new ObjectId(String(current.id)) }), removed);
            assert.strictEqual((await parentNative.findOne({ _id: new ObjectId(String(parent.id)) }))?._rev, 3);
            const emptyJSON = await queryJSON(Parent, { id: parent.id, $one: true, $include: ['profile'] });
            assert.ok(typeof emptyJSON === 'object' && emptyJSON !== null);
            assert.strictEqual(Reflect.get(emptyJSON, 'profile'), null);
            assert.strictEqual(await profileNative.countDocuments({ parent_id: parent.id }), 0);
            if (enabled) {
              assert.ok(typeof profileCache === 'object' && profileCache !== null);
              for (const [label, original, nativeBefore] of [
                ['current', current, removed],
                ['replacement', replacement, cleared],
              ] as const) {
                const canonical = call(profileCache, 'get', [original.id]);
                assert.strictEqual(canonical, original);
                assert.ok(canonical instanceof Profile);
                assert.strictEqual(canonical.get('_rev'), nativeBefore._rev);
                assert.strictEqual(canonical.get('parent'), null);
                await save(canonical, { name: `resaved detached ${label}` });
                const nativeAfter = await profileNative.findOne({ _id: new ObjectId(String(original.id)) });
                assert.ok(nativeAfter);
                assert.strictEqual(nativeAfter._rev, 4);
                assert.strictEqual(nativeAfter.parent_id, null);
                assert.strictEqual(nativeAfter.name, `resaved detached ${label}`);
                assert.strictEqual(canonical.get('_rev'), 4);
                assert.strictEqual(call(profileCache, 'get', [original.id]), canonical);
              }
              assert.strictEqual((await parentNative.findOne({ _id: new ObjectId(String(parent.id)) }))?._rev, 3);
              const afterFollowUps = await queryJSON(Parent, { id: parent.id, $one: true, $include: ['profile'] });
              assert.ok(typeof afterFollowUps === 'object' && afterFollowUps !== null);
              assert.strictEqual(Reflect.get(afterFollowUps, 'profile'), null);
            }
          } else if (phase === 'null') {
            parent.set('profile', replacement);
            await save(parent);
            const replacementBeforeNull = await profileNative.findOne({ _id: new ObjectId(String(replacement.id)) });
            assert.ok(replacementBeforeNull);
            assert.strictEqual(replacementBeforeNull.parent_id, parent.id);
            assert.strictEqual(replacementBeforeNull._rev, 2);
            await save(parent, { profile: null });
            assert.strictEqual(parent.get('profile'), null);
            assert.strictEqual(parent.get('_rev'), 4);
            const nulled = await profileNative.findOne({ _id: new ObjectId(String(replacement.id)) });
            const detached = await profileNative.findOne({ _id: new ObjectId(String(current.id)) });
            assert.ok(nulled && detached);
            const persisted = await queryJSON(Parent, { id: parent.id, $one: true, $include: ['profile'] });
            assert.ok(typeof persisted === 'object' && persisted !== null);
            assert.strictEqual(Reflect.get(persisted, 'profile'), null, `Native post-null observation: parent_id=${nulled.parent_id}, _rev=${nulled._rev}`);
            assert.strictEqual(nulled.parent_id, null);
            assert.strictEqual(nulled._rev, 3);
            assert.strictEqual(nulled.name, 'replacement');
            assert.strictEqual(detached.parent_id, null);
            assert.strictEqual(detached._rev, 3);
            assert.strictEqual(await profileNative.countDocuments({ parent_id: parent.id }), 0);
            if (enabled) {
              assert.ok(typeof profileCache === 'object' && profileCache !== null);
              for (const [label, original, nativeBefore] of [
                ['current', current, detached],
                ['replacement', replacement, nulled],
              ] as const) {
                const canonical = call(profileCache, 'get', [original.id]);
                assert.strictEqual(canonical, original);
                assert.ok(canonical instanceof Profile);
                assert.strictEqual(canonical.get('_rev'), nativeBefore._rev);
                assert.strictEqual(canonical.get('parent'), null);
                await save(canonical, { name: `resaved after null ${label}` });
                const nativeAfter = await profileNative.findOne({ _id: new ObjectId(String(original.id)) });
                assert.ok(nativeAfter);
                assert.strictEqual(nativeAfter._rev, 4);
                assert.strictEqual(nativeAfter.parent_id, null);
                assert.strictEqual(nativeAfter.name, `resaved after null ${label}`);
                assert.strictEqual(canonical.get('_rev'), 4);
                assert.strictEqual(call(profileCache, 'get', [original.id]), canonical);
              }
              assert.strictEqual((await parentNative.findOne({ _id: new ObjectId(String(parent.id)) }))?._rev, 4);
              const afterFollowUps = await queryJSON(Parent, { id: parent.id, $one: true, $include: ['profile'] });
              assert.ok(typeof afterFollowUps === 'object' && afterFollowUps !== null);
              assert.strictEqual(Reflect.get(afterFollowUps, 'profile'), null);
            }
          } else if (phase === 'cas') {
            const winner = await parentNative.findOneAndUpdate({ _id: new ObjectId(String(parent.id)), _rev: 2 }, { $set: { _rev: 3, name: 'winner' } }, { returnDocument: 'after', includeResultMetadata: false, upsert: false });
            assert.ok(winner);
            assert.strictEqual(winner._rev, 3);
            const replacementBefore = await profileNative.findOne({ _id: new ObjectId(String(replacement.id)) });
            assert.ok(replacementBefore);
            const stale = new Parent({ id: parent.id, name: 'stale', _rev: 2 });
            stale.set('profile', replacement);
            let staleSuccesses = 0;
            let staleErrors = 0;
            const staleFailure = await result((callback) =>
              call(stale, 'save', [
                null,
                {
                  success(value: unknown) {
                    staleSuccesses++;
                    callback(null, value);
                  },
                  error(_model: unknown, error: unknown) {
                    staleErrors++;
                    callback(null, error);
                  },
                },
              ])
            );
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.ok(staleFailure instanceof Error);
            assert.match(staleFailure.message, /revision \(_rev\) was stale/);
            assert.strictEqual(staleSuccesses, 0);
            assert.strictEqual(staleErrors, 1);
            assert.deepStrictEqual(await parentNative.findOne({ _id: new ObjectId(String(parent.id)) }), winner);
            assert.deepStrictEqual(await profileNative.findOne({ _id: new ObjectId(String(current.id)) }), currentRow);
            assert.deepStrictEqual(await profileNative.findOne({ _id: new ObjectId(String(replacement.id)) }), replacementBefore);

            await profileNative.createIndex({ name: 1 }, { unique: true });
            current.set('name', 'survivor');
            let driverSuccesses = 0;
            let driverErrors = 0;
            let deliveredError: unknown;
            const driverFailure = await result((callback) =>
              call(Profile.prototype, 'sync', [
                'update',
                current,
                {
                  success(value: unknown) {
                    driverSuccesses++;
                    callback(null, value);
                  },
                  error(error: unknown) {
                    driverErrors++;
                    deliveredError = error;
                    callback(null, error);
                  },
                },
              ])
            );
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.strictEqual(driverSuccesses, 0);
            assert.strictEqual(driverErrors, 1);
            assert.strictEqual(driverFailure, deliveredError);
            assert.ok(driverFailure instanceof Error);
            assert.strictEqual(driverFailure.message, 'Mongo update failed');
            assert.strictEqual(Reflect.get(driverFailure, 'code'), 11000);
            assert.strictEqual(Reflect.get(driverFailure, 'cause'), undefined);
            assert.strictEqual(driverFailure.message.includes(prefix), false);
            assert.strictEqual(driverFailure.message.includes('survivor'), false);
            assert.deepStrictEqual(await parentNative.findOne({ _id: new ObjectId(String(parent.id)) }), winner);
            assert.deepStrictEqual(await profileNative.findOne({ _id: new ObjectId(String(current.id)) }), currentRow);
            assert.deepStrictEqual(await profileNative.findOne({ _id: new ObjectId(String(replacement.id)) }), replacementBefore);
            assert.strictEqual(current.get('_rev'), 2);
            assert.strictEqual(current.get('name'), 'survivor', 'Caller attributes are not rolled back on raw failure');
          } else {
            const declared = call(Parent, 'relation', ['profile']);
            const generated = call(Profile, 'relation', ['parent']);
            assert.ok(typeof declared === 'object' && declared !== null);
            assert.ok(typeof generated === 'object' && generated !== null);
            assert.strictEqual(Reflect.get(generated, 'type'), 'belongsTo');
            assert.strictEqual(Reflect.get(generated, 'foreign_key'), 'parent_id');
            assert.strictEqual(Reflect.get(generated, 'reverse_relation'), declared);
            assert.strictEqual(Reflect.get(declared, 'reverse_relation'), generated);
            const included = await queryJSON(Parent, { id: parent.id, $one: true, $include: ['profile'] });
            assert.ok(typeof included === 'object' && included !== null);
            const related: unknown = Reflect.get(included, 'profile');
            assert.ok(typeof related === 'object' && related !== null);
            assert.strictEqual(Reflect.get(related, 'id'), current.id);
            const inverse = await queryJSON(Profile, { id: current.id, $one: true, $include: ['parent'] });
            assert.ok(typeof inverse === 'object' && inverse !== null);
            const relatedParent: unknown = Reflect.get(inverse, 'parent');
            assert.ok(typeof relatedParent === 'object' && relatedParent !== null);
            assert.strictEqual(Reflect.get(relatedParent, 'id'), parent.id);
          }
          assert.deepStrictEqual(await profileNative.findOne({ _id: new ObjectId(String(survivor.id)) }), survivorBefore);
          assert.deepStrictEqual(await parentNative.findOne({ _id: new ObjectId(String(unrelated.id)) }), unrelatedBefore);
          assert.strictEqual(await parentNative.countDocuments(), 3);
          assert.strictEqual(await profileNative.countDocuments(), 3);
        } catch (error: unknown) {
          failed = true;
          failure = error;
        } finally {
          for (const control of controls) {
            try {
              await control.destroy();
              await assert.rejects(collection(control), /closed/);
            } catch (error: unknown) {
              cleanupErrors.push(error);
            }
          }
          try {
            ORM.configure({ model_cache: { enabled: false } });
          } catch (error: unknown) {
            cleanupErrors.push(error);
          }
        }
        if (cleanupErrors.length) throw new AggregateError(failed ? [failure, ...cleanupErrors] : cleanupErrors, 'HasOne operation/cleanup failed');
        if (failed) throw failure;
      });
    }
  }

  for (const enabled of [false, true]) {
    for (const childFirst of [false, true]) {
      const cell = `cache=${enabled}, child-first=${childFirst}`;
      const prefix = `relations_${enabled ? 'on' : 'off'}_${childFirst ? 'child' : 'parent'}`;

      function relationTypes(phase: string, generated = false) {
        ORM.configure({ model_cache: { enabled, max: 100 } });
        class Parent extends Backbone.Model {
          static model_name = 'Parent';
          urlRoot = `${server.uri}/${prefix}_${phase}_parents`;
          schema() {
            return { children: ['hasMany', Child, { as: 'parent' }] };
          }
        }
        class Child extends Backbone.Model {
          static model_name = 'Child';
          urlRoot = `${server.uri}/${prefix}_${phase}_children`;
          schema() {
            return generated ? {} : { parent: ['belongsTo', Parent, { as: 'children' }] };
          }
        }
        if (childFirst) Child.prototype.sync = Mongo.sync(Child);
        Parent.prototype.sync = Mongo.sync(Parent);
        Child.prototype.sync = Mongo.sync(Child);
        return { Parent, Child, controls: [connection(Parent), connection(Child)] };
      }

      async function releaseRelations(controls: MongoConnectionControl[]) {
        const settled = await Promise.allSettled(controls.map((control) => control.destroy()));
        ORM.configure({ model_cache: { enabled: false } });
        const failures = settled.filter((entry) => entry.status === 'rejected').map((entry) => entry.reason);
        if (failures.length) throw new AggregateError(failures, 'Relation fixture connection cleanup failed');
      }

      if (!childFirst) {
        it(`persists native paired self relations through lazy/include, reassignment, patch and delete (cache=${enabled})`, async () => {
          ORM.configure({ model_cache: { enabled, max: 100 } });
          const table = `${prefix}_paired_self_lifecycle`;
          class SelfReference extends Backbone.Model {
            static model_name = 'SelfReference';
            urlRoot = `${server.uri}/${table}`;
            schema() {
              return {
                owner: ['belongsTo', SelfReference, { foreign_key: 'owner_id', as: 'self_references' }],
                self_references: ['hasMany', SelfReference, { as: 'owner' }],
              };
            }
          }
          SelfReference.prototype.sync = Mongo.sync(SelfReference);
          const controls = [connection(SelfReference)];
          let failed = false;
          let failure: unknown;
          const cleanupErrors: unknown[] = [];
          try {
            const schema = call(SelfReference, 'schema');
            assert.ok(typeof schema === 'object' && schema !== null);
            const owner = call(schema, 'relation', ['owner']);
            const inverse = call(schema, 'relation', ['self_references']);
            assert.ok(typeof owner === 'object' && owner !== null && typeof inverse === 'object' && inverse !== null);
            assert.strictEqual(Reflect.get(owner, 'model_type'), SelfReference);
            assert.strictEqual(Reflect.get(owner, 'reverse_model_type'), SelfReference);
            assert.strictEqual(Reflect.get(owner, 'type'), 'belongsTo');
            assert.strictEqual(Reflect.get(inverse, 'type'), 'hasMany');
            assert.strictEqual(Reflect.get(inverse, 'model_type'), SelfReference);
            assert.strictEqual(Reflect.get(inverse, 'reverse_model_type'), SelfReference);
            assert.strictEqual(Reflect.get(owner, 'reverse_relation'), inverse);
            assert.strictEqual(Reflect.get(inverse, 'reverse_relation'), owner);
            assert.strictEqual(Reflect.get(owner, 'foreign_key'), 'owner_id');
            assert.deepStrictEqual(call(schema, 'joinTables'), []);
            const first = new SelfReference({ name: 'first owner' });
            const replacement = new SelfReference({ name: 'replacement owner' });
            await save(first);
            await save(replacement);
            const addedByOne = new SelfReference({ name: 'belongsTo child', owner: first });
            const addedByMany = new SelfReference({ name: 'hasMany child' });
            await save(addedByOne);
            await save(addedByMany);
            first.set('self_references', [addedByOne, addedByMany]);
            await save(first);
            const native = server.client.db('production_port').collection(table);
            const initial = await native.find({}).sort({ name: 1 }).toArray();
            assert.deepStrictEqual(initial.map(({ name, owner_id, _rev }) => ({ name, owner_id, _rev })), [
              { name: 'belongsTo child', owner_id: first.id, _rev: 1 },
              { name: 'first owner', owner_id: null, _rev: 2 },
              { name: 'hasMany child', owner_id: first.id, _rev: 2 },
              { name: 'replacement owner', owner_id: null, _rev: 1 },
            ]);
            for (const row of initial) {
              assert.ok(row._id instanceof ObjectId);
              assert.strictEqual(row.id, undefined);
              assert.strictEqual(row.self_references, undefined);
              if (row.owner_id !== null) assert.strictEqual(typeof row.owner_id, 'string');
            }
            for (const model of [first, replacement, addedByOne, addedByMany]) {
              assert.strictEqual(typeof model.id, 'string');
              assert.match(model.id, /^[0-9a-f]{24}$/);
            }
            assert.deepStrictEqual(initial.map((row) => row._id.toHexString()).sort(), [first.id, replacement.id, addedByOne.id, addedByMany.id].sort());
            assert.strictEqual(first.get('_rev'), 2);
            const fresh = new SelfReference({ id: first.id });
            await fetch(fresh);
            let lazyNotifications = 0;
            let lazyReturn: unknown;
            const children = await result((callback) => {
              lazyReturn = call(fresh, 'get', ['self_references', (error: unknown, value?: unknown) => {
                lazyNotifications++;
                callback(error, value);
              }]);
            });
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.strictEqual(lazyNotifications, 1);
            assert.ok(lazyReturn instanceof Backbone.Collection);
            assert.strictEqual(children, lazyReturn.models);
            assert.deepStrictEqual(lazyReturn.models.map((model) => model.id).sort(), [addedByOne.id, addedByMany.id].sort());
            const freshChild = new SelfReference({ id: addedByOne.id });
            await fetch(freshChild);
            assert.strictEqual(freshChild.id, addedByOne.id);
            if (enabled) {
              const cache: unknown = Reflect.get(SelfReference, 'cache');
              assert.ok(typeof cache === 'object' && cache !== null);
              assert.strictEqual(call(cache, 'get', [freshChild.id]), freshChild);
            }
            let ownerNotifications = 0;
            let ownerReturn: unknown;
            const loadedOwner = await result((callback) => {
              ownerReturn = call(freshChild, 'get', ['owner', (error: unknown, value?: unknown) => {
                ownerNotifications++;
                callback(error, value);
              }]);
            });
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.strictEqual(ownerNotifications, 1);
            assert.ok(ownerReturn instanceof SelfReference);
            assert.strictEqual(ownerReturn.id, first.id);
            assert.ok(loadedOwner instanceof SelfReference);
            assert.strictEqual(loadedOwner.id, first.id);
            assert.strictEqual(loadedOwner, ownerReturn);
            const included = await queryJSON(SelfReference, { id: first.id, $include: ['self_references'], $one: true });
            assert.ok(typeof included === 'object' && included !== null);
            const includedChildren: unknown = Reflect.get(included, 'self_references');
            assert.ok(Array.isArray(includedChildren));
            assert.deepStrictEqual(includedChildren.map((row) => ({ id: row.id, owner_id: row.owner_id, _rev: row._rev })).sort((a, b) => String(a.id).localeCompare(String(b.id))), [
              { id: addedByOne.id, owner_id: first.id, _rev: 1 },
              { id: addedByMany.id, owner_id: first.id, _rev: 2 },
            ].sort((a, b) => String(a.id).localeCompare(String(b.id))));
            const models = await materialize(publicCursor(SelfReference, { id: addedByOne.id, $include: ['owner'] }));
            const repeated = await materialize(publicCursor(SelfReference, { id: addedByOne.id, $include: ['owner'] }));
            assert.ok(models[0].get('owner') instanceof SelfReference);
            assert.strictEqual(models[0].get('owner').id, first.id);
            if (enabled) {
              assert.strictEqual(models[0], freshChild);
              assert.strictEqual(repeated[0], freshChild);
              assert.strictEqual(models[0].get('owner'), first);
              assert.strictEqual(loadedOwner, first);
            }
            await save(addedByOne, { owner: replacement });
            await save(addedByMany, { owner: replacement });
            assert.deepStrictEqual((await native.find({ owner_id: replacement.id }).sort({ name: 1 }).toArray()).map(({ name, owner_id, _rev }) => ({ name, owner_id, _rev })), [
              { name: 'belongsTo child', owner_id: replacement.id, _rev: 2 },
              { name: 'hasMany child', owner_id: replacement.id, _rev: 3 },
            ]);
            assert.deepStrictEqual(await queryJSON(SelfReference, { owner_id: first.id }), []);
            await save(addedByOne, { owner: null });
            assert.strictEqual((await native.findOne({ _id: new ObjectId(String(addedByOne.id)) }))?.owner_id, null);
            assert.strictEqual((await native.findOne({ _id: new ObjectId(String(addedByOne.id)) }))?._rev, 3);
            addedByMany.unset('owner_id');
            addedByMany.set('owner', first);
            await save(addedByMany);
            const reassigned = await native.findOne({ _id: new ObjectId(String(addedByMany.id)) });
            assert.ok(reassigned);
            assert.strictEqual(reassigned.owner_id, first.id);
            assert.strictEqual(reassigned._rev, 4);
            assert.strictEqual(call(ORM.Utils, 'get', [addedByMany, 'unsets']), undefined);
            let patchNotifications = 0;
            await result((callback) => call(first, 'patchAdd', ['self_references', addedByOne.id, (error: unknown) => {
              patchNotifications++;
              callback(error);
            }]));
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.strictEqual(patchNotifications, 1);
            const patched = await native.findOne({ _id: new ObjectId(String(addedByOne.id)) });
            assert.ok(patched);
            assert.strictEqual(patched.owner_id, first.id);
            assert.strictEqual(patched._rev, 4);
            let removeNotifications = 0;
            await result((callback) => call(first, 'patchRemove', ['self_references', addedByOne.id, (error: unknown) => {
              removeNotifications++;
              callback(error);
            }]));
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.strictEqual(removeNotifications, 1);
            const removed = await native.findOne({ _id: new ObjectId(String(addedByOne.id)) });
            assert.ok(removed);
            assert.strictEqual(removed.owner_id, null);
            assert.strictEqual(removed._rev, 5);
            const retainedOwner = new SelfReference({ name: 'retained owner' });
            await save(retainedOwner);
            const untouched = new SelfReference({ name: 'untouched child', owner: retainedOwner });
            const staticChild = new SelfReference({ name: 'static child', owner: replacement });
            await save(untouched);
            await save(staticChild);
            const retainedBefore = await native.findOne({ _id: new ObjectId(String(retainedOwner.id)) });
            const untouchedBefore = await native.findOne({ _id: new ObjectId(String(untouched.id)) });
            let deleteNotifications = 0;
            await result((callback) => first.destroy({
              success() { deleteNotifications++; callback(null); },
              error(_model, error: unknown) { deleteNotifications++; callback(error); },
            }));
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.strictEqual(deleteNotifications, 1);
            assert.strictEqual(await native.findOne({ _id: new ObjectId(String(first.id)) }), null);
            const cleaned = await native.findOne({ _id: new ObjectId(String(addedByMany.id)) });
            assert.ok(cleaned);
            assert.strictEqual(cleaned.owner_id, null);
            assert.strictEqual(cleaned._rev, 5);
            let staticNotifications = 0;
            const destroyed = await result((callback) => call(SelfReference, 'destroy', [{ id: replacement.id }, (error: unknown, count?: unknown) => {
              staticNotifications++;
              callback(error, count);
            }]));
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.strictEqual(staticNotifications, 1);
            assert.strictEqual(destroyed, 1);
            assert.strictEqual(await native.findOne({ _id: new ObjectId(String(replacement.id)) }), null);
            const staticCleaned = await native.findOne({ _id: new ObjectId(String(staticChild.id)) });
            assert.ok(staticCleaned);
            assert.strictEqual(staticCleaned.owner_id, null);
            assert.strictEqual(staticCleaned._rev, 2);
            assert.deepStrictEqual(await native.findOne({ _id: new ObjectId(String(retainedOwner.id)) }), retainedBefore);
            assert.deepStrictEqual(await native.findOne({ _id: new ObjectId(String(untouched.id)) }), untouchedBefore);
            if (enabled) {
              const cache: unknown = Reflect.get(SelfReference, 'cache');
              assert.ok(typeof cache === 'object' && cache !== null);
              assert.strictEqual(call(cache, 'get', [first.id]), undefined);
              assert.strictEqual(call(cache, 'get', [replacement.id]), undefined);
              assert.strictEqual(call(cache, 'get', [addedByMany.id]), addedByMany);
              assert.strictEqual(addedByMany.get('owner'), null);
              assert.strictEqual(addedByMany.get('_rev'), 5);
              assert.strictEqual(call(cache, 'get', [staticChild.id]), staticChild);
              assert.strictEqual(staticChild.get('owner'), null);
              assert.strictEqual(staticChild.get('_rev'), 2);
              assert.strictEqual(call(cache, 'get', [retainedOwner.id]), retainedOwner);
              assert.strictEqual(call(cache, 'get', [untouched.id]), untouched);
            }
          } catch (error: unknown) {
            failed = true;
            failure = error;
          } finally {
            try { await releaseRelations(controls); } catch (error: unknown) { cleanupErrors.push(error); }
            if (failed || cleanupErrors.length) {
              console.error('Paired self lifecycle failures:', inspect({ operationFailed: failed, operationFailure: failure, cleanupErrors }, { depth: null, maxArrayLength: null, maxStringLength: null, colors: false }));
              throw new AggregateError([...(failed ? [failure] : []), ...cleanupErrors], 'Paired self lifecycle operation/cleanup failed');
            }
          }
        });

        it(`database tools preserve native paired self indexes, UUID and reset cache ownership (cache=${enabled})`, async () => {
          ORM.configure({ model_cache: { enabled, max: 100 } });
          const table = `${prefix}_paired_self_schema`;
          class SelfReference extends Backbone.Model {
            static model_name = 'SelfReference';
            urlRoot = `${server.uri}/${table}`;
            schema() {
              return {
                name: ['String', { indexed: true }],
                owner: ['belongsTo', SelfReference, { foreign_key: 'owner_id', as: 'self_references' }],
                self_references: ['hasMany', SelfReference, { as: 'owner' }],
              };
            }
          }
          class Unrelated extends Backbone.Model {
            urlRoot = `${server.uri}/${table}_unrelated`;
          }
          SelfReference.prototype.sync = Mongo.sync(SelfReference);
          Unrelated.prototype.sync = Mongo.sync(Unrelated);
          const controls = [connection(SelfReference), connection(Unrelated)];
          let failed = false;
          let failure: unknown;
          const cleanupErrors: unknown[] = [];
          try {
            const database = server.client.db('production_port');
            const existingNames = (await database.listCollections({}).toArray()).map((entry) => entry.name);
            const native = await database.createCollection(table, { validator: { name: { $type: 'string' } }, validationLevel: 'strict' });
            await native.createIndex({ name: 1, _rev: -1 }, { name: 'retained_custom' });
            const parent = new SelfReference({ name: 'owner' });
            await save(parent);
            const child = new SelfReference({ name: 'child', owner: parent });
            const unrelated = new Unrelated({ name: 'outside owner' });
            await save(child);
            await save(unrelated);
            const unrelatedNative = database.collection(`${table}_unrelated`);
            const unrelatedRows = await unrelatedNative.find({}).toArray();
            const unrelatedIndexes = await unrelatedNative.listIndexes().toArray();
            const unrelatedNamespaces = await database.listCollections({ name: `${table}_unrelated` }).toArray();
            const namespaces = await database.listCollections({ name: table }).toArray();
            assert.ok(namespaces[0]?.info?.uuid);
            const before = await native.find({}).toArray();
            const originalIndexes = await native.listIndexes().toArray();
            const db = call(SelfReference, 'db');
            assert.ok(typeof db === 'object' && db !== null);
            const cache: unknown = Reflect.get(SelfReference, 'cache');
            const unrelatedCache: unknown = Reflect.get(Unrelated, 'cache');
            for (const options of [undefined, {}]) {
              assert.deepStrictEqual(await schemaOutcome(db, 'ensureSchema', options), [null]);
              assert.deepStrictEqual(await native.find({}).toArray(), before);
              assert.deepStrictEqual(await database.listCollections({ name: table }).toArray(), namespaces);
              const indexes = await native.listIndexes().toArray();
              for (const index of originalIndexes) assert.deepStrictEqual(indexes.find((entry) => entry.name === index.name), index);
              assert.deepStrictEqual(indexes.find((entry) => entry.name === '_id_')?.key, { _id: 1 });
              assert.deepStrictEqual(indexes.find((entry) => entry.name === 'name_1')?.key, { name: 1 });
              assert.deepStrictEqual(indexes.find((entry) => entry.name === 'owner_id_1')?.key, { owner_id: 1 });
              assert.strictEqual(indexes.find((entry) => entry.name === 'owner_id_1')?.unique, undefined);
              if (enabled) {
                assert.ok(typeof cache === 'object' && cache !== null);
                assert.strictEqual(call(cache, 'get', [parent.id]), parent);
                assert.strictEqual(call(cache, 'get', [child.id]), child);
              }
            }
            const indexes = await native.listIndexes().toArray();
            for (const route of ['direct', 'static']) {
              for (const options of [undefined, {}]) {
                const insertedParent = new SelfReference({ name: `${route} owner` });
                await save(insertedParent);
                const insertedChild = new SelfReference({ name: `${route} child`, owner: insertedParent });
                await save(insertedChild);
                const inserted = await native.findOne({ _id: new ObjectId(String(insertedChild.id)) });
                assert.ok(inserted);
                assert.strictEqual(inserted.owner_id, insertedParent.id);
                assert.strictEqual(inserted._rev, 1);
                let notifications = 0;
                let returnedToCaller = false;
                let asynchronous = false;
                const values = await new Promise<unknown[]>((resolve) => {
                  const notify = (...args: unknown[]) => {
                    notifications++;
                    asynchronous = returnedToCaller;
                    resolve(args);
                  };
                  const returned = call(route === 'direct' ? db : SelfReference, 'resetSchema', options === undefined ? [notify] : [options, notify]);
                  assert.strictEqual(returned, enabled && route === 'static' ? cache : undefined);
                  returnedToCaller = true;
                });
                await new Promise<void>((resolve) => setImmediate(resolve));
                assert.strictEqual(notifications, 1);
                assert.strictEqual(asynchronous, true);
                assert.deepStrictEqual(values, [null]);
                assert.deepStrictEqual(await native.find({}).toArray(), []);
                assert.deepStrictEqual(await native.listIndexes().toArray(), indexes);
                assert.deepStrictEqual(await database.listCollections({ name: table }).toArray(), namespaces);
                assert.deepStrictEqual(await unrelatedNative.find({}).toArray(), unrelatedRows);
                assert.deepStrictEqual(await unrelatedNative.listIndexes().toArray(), unrelatedIndexes);
                assert.deepStrictEqual(await database.listCollections({ name: `${table}_unrelated` }).toArray(), unrelatedNamespaces);
                if (enabled) {
                  assert.ok(typeof cache === 'object' && cache !== null && typeof unrelatedCache === 'object' && unrelatedCache !== null);
                  assert.strictEqual(call(cache, 'get', [insertedParent.id]), route === 'direct' ? insertedParent : undefined);
                  assert.strictEqual(call(cache, 'get', [insertedChild.id]), route === 'direct' ? insertedChild : undefined);
                  assert.strictEqual(call(unrelatedCache, 'get', [unrelated.id]), unrelated);
                }
              }
            }
            const schema = call(SelfReference, 'schema');
            assert.ok(typeof schema === 'object' && schema !== null);
            assert.deepStrictEqual(call(schema, 'joinTables'), []);
            assert.deepStrictEqual((await database.listCollections({}).toArray()).map((entry) => entry.name).filter((name) => !existingNames.includes(name)).sort(), [table, `${table}_unrelated`].sort());
          } catch (error: unknown) {
            failed = true;
            failure = error;
          } finally {
            try { await releaseRelations(controls); } catch (error: unknown) { cleanupErrors.push(error); }
            if (failed || cleanupErrors.length) {
              console.error('Paired self schema failures:', inspect({ operationFailed: failed, operationFailure: failure, cleanupErrors }, { depth: null, maxArrayLength: null, maxStringLength: null, colors: false }));
              throw new AggregateError([...(failed ? [failure] : []), ...cleanupErrors], 'Paired self schema operation/cleanup failed');
            }
          }
        });

        for (const route of ['instance', 'static']) {
          it(`reports native paired self ${route} deletion before real cleanup rejection (cache=${enabled})`, async () => {
            ORM.configure({ model_cache: { enabled, max: 100 } });
            const table = `${prefix}_paired_self_partial_${route}`;
            class SelfReference extends Backbone.Model {
              static model_name = 'SelfReference';
              urlRoot = `${server.uri}/${table}`;
              schema() {
                return {
                  owner: ['belongsTo', SelfReference, { foreign_key: 'owner_id', as: 'self_references' }],
                  self_references: ['hasMany', SelfReference, { as: 'owner' }],
                };
              }
            }
            SelfReference.prototype.sync = Mongo.sync(SelfReference);
            const controls = [connection(SelfReference)];
            let failed = false;
            let failure: unknown;
            const cleanupErrors: unknown[] = [];
            try {
              const parent = new SelfReference({ name: 'deleted' });
              const survivor = new SelfReference({ name: 'survivor' });
              await save(parent);
              await save(survivor);
              const child = new SelfReference({ name: 'blocked child', owner: parent });
              const untouched = new SelfReference({ name: 'untouched child', owner: survivor });
              await save(child);
              await save(untouched);
              const database = server.client.db('production_port');
              const native = database.collection(table);
              const survivorBefore = await native.findOne({ _id: new ObjectId(String(survivor.id)) });
              const childBefore = await native.findOne({ _id: new ObjectId(String(child.id)) });
              const untouchedBefore = await native.findOne({ _id: new ObjectId(String(untouched.id)) });
              assert.ok(survivorBefore && childBefore && untouchedBefore);
              await database.command({ collMod: table, validator: { owner_id: { $type: 'string' } }, validationLevel: 'strict', validationAction: 'error' });
              let notifications = 0;
              let delivered: unknown;
              await assert.rejects(result((callback) => route === 'instance' ? parent.destroy({
                success() { notifications++; callback(null); },
                error(_model, error: unknown) { notifications++; delivered = error; callback(error); },
              }) : call(SelfReference, 'destroy', [{ id: parent.id }, (error: unknown, count?: unknown) => {
                notifications++;
                delivered = error;
                callback(error, count);
              }])), (error: unknown) => error === delivered && error instanceof Error && Reflect.get(error, 'code') === 121);
              await new Promise<void>((resolve) => setImmediate(resolve));
              assert.strictEqual(notifications, 1);
              assert.strictEqual(await native.findOne({ _id: new ObjectId(String(parent.id)) }), null);
              assert.deepStrictEqual(await native.findOne({ _id: new ObjectId(String(survivor.id)) }), survivorBefore);
              assert.deepStrictEqual(await native.findOne({ _id: new ObjectId(String(child.id)) }), childBefore);
              assert.deepStrictEqual(await native.findOne({ _id: new ObjectId(String(untouched.id)) }), untouchedBefore);
              if (enabled) {
                const cache: unknown = Reflect.get(SelfReference, 'cache');
                assert.ok(typeof cache === 'object' && cache !== null);
                assert.strictEqual(call(cache, 'get', [parent.id]), undefined);
                assert.strictEqual(call(cache, 'get', [survivor.id]), survivor);
                assert.strictEqual(call(cache, 'get', [untouched.id]), untouched);
              }
            } catch (error: unknown) {
              failed = true;
              failure = error;
            } finally {
              try { await releaseRelations(controls); } catch (error: unknown) { cleanupErrors.push(error); }
              if (failed || cleanupErrors.length) {
                console.error('Paired self partial failures:', inspect({ route, operationFailed: failed, operationFailure: failure, cleanupErrors }, { depth: null, maxArrayLength: null, maxStringLength: null, colors: false }));
                throw new AggregateError([...(failed ? [failure] : []), ...cleanupErrors], 'Paired self partial operation/cleanup failed');
              }
            }
          });
        }

        it(`rejects native self near-pairs before rows or indexes and retains failed readiness (cache=${enabled})`, async () => {
          ORM.configure({ model_cache: { enabled, max: 100 } });
          const controls: MongoConnectionControl[] = [];
          let failed = false;
          let failure: unknown;
          const cleanupErrors: unknown[] = [];
          try {
            for (const variant of ['hasOne', 'ambiguous']) {
              const table = `${prefix}_paired_self_rejected_${variant}`;
              class Rejected extends Backbone.Model {
                static model_name = 'Rejected';
                urlRoot = `${server.uri}/${table}`;
                schema() {
                  return variant === 'hasOne' ? {
                    owner: ['belongsTo', Rejected, { as: 'children' }],
                    children: ['hasOne', Rejected, { as: 'owner' }],
                  } : {
                    owner: ['belongsTo', Rejected, { as: 'children' }],
                    children: ['hasMany', Rejected, { as: 'other_owner' }],
                    other_owner: ['belongsTo', Rejected, { as: 'children' }],
                  };
                }
              }
              let registrationFailure: unknown;
              assert.throws(() => Mongo.sync(Rejected), (error: unknown) => {
                registrationFailure = error;
                return error instanceof Error;
              });
              assert.ok(registrationFailure instanceof Error);
              controls.push(connection(Rejected));
              assert.throws(() => Mongo.sync(Rejected), (error: unknown) => error === registrationFailure);
              await assert.rejects(queryJSON(Rejected, {}), (error: unknown) => error === registrationFailure);
              const db = call(Rejected, 'db');
              assert.ok(typeof db === 'object' && db !== null);
              assert.deepStrictEqual(await schemaOutcome(db, 'ensureSchema'), [registrationFailure]);
              assert.deepStrictEqual(await schemaOutcome(db, 'resetSchema', {}), [registrationFailure]);
              assert.deepStrictEqual(await server.client.db('production_port').listCollections({ name: table }).toArray(), []);
            }
          } catch (error: unknown) {
            failed = true;
            failure = error;
          } finally {
            try { await releaseRelations(controls); } catch (error: unknown) { cleanupErrors.push(error); }
            if (failed || cleanupErrors.length) {
              console.error('Paired self admission failures:', inspect({ operationFailed: failed, operationFailure: failure, cleanupErrors }, { depth: null, maxArrayLength: null, maxStringLength: null, colors: false }));
              throw new AggregateError([...(failed ? [failure] : []), ...cleanupErrors], 'Paired self admission operation/cleanup failed');
            }
          }
        });
      }

      it(`database tools clear rows while preserving collection, indexes and related caches (${cell})`, async () => {
        const { Parent, Child, controls } = relationTypes('database_clear', true);
        let failed = false;
        let failure: unknown;
        const cleanupErrors: unknown[] = [];
        try {
          const database = server.client.db('production_port');
          const table = `${prefix}_database_clear_parents`;
          const native = await database.createCollection(table, { validator: { name: { $type: 'string' } }, validationLevel: 'strict' });
          await native.createIndex({ name: 1, _rev: -1 }, { name: 'retained_custom' });
          const parent = new Parent({ name: 'parent' });
          const survivor = new Parent({ name: 'also cleared' });
          await save(parent);
          await save(survivor);
          const child = new Child({ name: 'kept child', parent });
          await save(child);
          const childNative = database.collection(`${prefix}_database_clear_children`);
          const childRows = await childNative.find({}).sort({ _id: 1 }).toArray();
          assert.deepStrictEqual(childRows.map(({ name, parent_id, _rev }) => ({ name, parent_id, _rev })), [{ name: 'kept child', parent_id: parent.id, _rev: 1 }]);
          assert.strictEqual(await native.countDocuments(), 2);
          const unrelated = database.collection(`${prefix}_database_clear_unrelated`);
          await unrelated.insertOne({ name: 'untouched', _rev: 9 });
          const unrelatedRows = await unrelated.find({}).toArray();
          const namespaces = await database.listCollections({ name: table }).toArray();
          assert.ok(namespaces[0]?.info?.uuid);
          const indexes = await native.listIndexes().toArray();
          const db = call(Parent, 'db');
          assert.ok(typeof db === 'object' && db !== null);
          assert.strictEqual(call(Parent, 'db'), db);
          assert.strictEqual(Reflect.get(db, 'connection'), controls[0]);
          const parentCache: unknown = Reflect.get(Parent, 'cache');
          const childCache: unknown = Reflect.get(Child, 'cache');
          if (enabled) {
            assert.ok(typeof parentCache === 'object' && parentCache !== null);
            assert.ok(typeof childCache === 'object' && childCache !== null);
            assert.strictEqual(call(parentCache, 'get', [parent.id]), parent);
            assert.strictEqual(call(childCache, 'get', [child.id]), child);
          }
          const drop: unknown = Reflect.get(db, 'dropTable');
          assert.ok(typeof drop === 'function');
          for (const options of [{}, undefined]) {
            let notifications = 0;
            let returnedToCaller = false;
            let asynchronous = false;
            const values = await new Promise<unknown[]>((resolve) => {
              const notify = (...args: unknown[]) => {
                notifications++;
                asynchronous = returnedToCaller;
                resolve(args);
              };
              const returned: unknown = Reflect.apply(drop, undefined, options === undefined ? [notify] : [options, notify]);
              assert.strictEqual(returned, undefined);
              returnedToCaller = true;
            });
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.strictEqual(notifications, 1);
            assert.strictEqual(asynchronous, true);
            assert.deepStrictEqual(values, [null]);
            assert.deepStrictEqual(await native.find({}).toArray(), []);
            assert.deepStrictEqual(await native.listIndexes().toArray(), indexes);
            assert.deepStrictEqual(await database.listCollections({ name: table }).toArray(), namespaces);
            assert.deepStrictEqual(await childNative.find({}).sort({ _id: 1 }).toArray(), childRows);
            assert.deepStrictEqual(await unrelated.find({}).toArray(), unrelatedRows);
            if (enabled) {
              assert.ok(typeof parentCache === 'object' && parentCache !== null);
              assert.ok(typeof childCache === 'object' && childCache !== null);
              assert.strictEqual(call(parentCache, 'get', [parent.id]), parent);
              assert.strictEqual(call(parentCache, 'get', [survivor.id]), survivor);
              assert.strictEqual(call(childCache, 'get', [child.id]), child);
            }
          }
          const childDb = call(Child, 'db');
          assert.ok(typeof childDb === 'object' && childDb !== null);
          await result((callback) => call(childDb, 'createOrUpdateTable', [{}, callback]));
          const childIndexes = await childNative.listIndexes().toArray();
          assert.deepStrictEqual(childIndexes.find((index) => index.name === 'parent_id_1')?.key, { parent_id: 1 });
          assert.deepStrictEqual(await childNative.find({}).sort({ _id: 1 }).toArray(), childRows);
          assert.deepStrictEqual(await native.find({}).toArray(), []);
        } catch (error: unknown) {
          failed = true;
          failure = error;
        } finally {
          try {
            await releaseRelations(controls);
          } catch (error: unknown) {
            cleanupErrors.push(error);
          }
          if (failed || cleanupErrors.length) {
            console.error('Database clear failures:', inspect({ operationFailed: failed, operationFailure: failure, cleanupErrors }, { depth: null, maxArrayLength: null, maxStringLength: null, colors: false }));
            throw new AggregateError([...(failed ? [failure] : []), ...cleanupErrors], 'Database clear operation/cleanup failed');
          }
        }
      });

      for (const kind of ['hasMany', 'hasOne']) {
        it(`database tools outer schema preserves ordinary ${kind} rows and cache ownership (${cell})`, async () => {
          ORM.configure({ model_cache: { enabled, max: 100 } });
          const table = `${prefix}_outer_${kind}_parents`;
          const relatedTable = `${prefix}_outer_${kind}_related`;
          class Parent extends Backbone.Model {
            static model_name = 'Parent';
            urlRoot = `${server.uri}/${table}`;
            schema() {
              return { id: ['Integer', { indexed: true }], name: ['String', { indexed: true }], related: [kind, Related, { as: 'parent' }] };
            }
          }
          class Related extends Backbone.Model {
            static model_name = 'Related';
            urlRoot = `${server.uri}/${relatedTable}`;
            schema() {
              return {};
            }
          }
          if (childFirst) Related.prototype.sync = Mongo.sync(Related);
          Parent.prototype.sync = Mongo.sync(Parent);
          Related.prototype.sync = Mongo.sync(Related);
          const controls = [connection(Parent), connection(Related)];
          let failed = false;
          let failure: unknown;
          const cleanupErrors: unknown[] = [];
          try {
            const database = server.client.db('production_port');
            const native = await database.createCollection(table, { validator: { name: { $type: 'string' } }, validationLevel: 'strict' });
            await native.createIndex({ name: 1, _rev: -1 }, { name: 'retained_custom' });
            const parent = new Parent({ name: 'original parent' });
            await save(parent);
            const related = new Related({ name: 'retained relation', parent });
            await save(related);
            const relatedNative = database.collection(relatedTable);
            const relatedRows = await relatedNative.find({}).toArray();
            const relatedIndexes = await relatedNative.listIndexes().toArray();
            const relatedNamespaces = await database.listCollections({ name: relatedTable }).toArray();
            assert.ok(relatedNamespaces[0]?.info?.uuid);
            assert.deepStrictEqual(relatedRows.map(({ name, parent_id, _rev }) => ({ name, parent_id, _rev })), [{ name: 'retained relation', parent_id: parent.id, _rev: 1 }]);
            const unrelated = database.collection(`${table}_unrelated`);
            await unrelated.insertOne({ name: 'retained unrelated', _rev: 9 });
            const unrelatedRows = await unrelated.find({}).toArray();
            const namespaces = await database.listCollections({ name: table }).toArray();
            assert.ok(namespaces[0]?.info?.uuid);
            const originalIndexes = await native.listIndexes().toArray();
            const before = await native.find({}).toArray();
            const db = call(Parent, 'db');
            assert.ok(typeof db === 'object' && db !== null);
            assert.strictEqual(call(Parent, 'db'), db);
            const parentCache: unknown = Reflect.get(Parent, 'cache');
            const relatedCache: unknown = Reflect.get(Related, 'cache');
            const ensure: unknown = Reflect.get(db, 'ensureSchema');
            assert.ok(typeof ensure === 'function');
            for (const options of [undefined, {}]) {
              let notifications = 0;
              let returnedToCaller = false;
              let asynchronous = false;
              const values = await new Promise<unknown[]>((resolve) => {
                const notify = (...args: unknown[]) => {
                  notifications++;
                  asynchronous = returnedToCaller;
                  resolve(args);
                };
                const returned: unknown = Reflect.apply(ensure, undefined, options === undefined ? [notify] : [options, notify]);
                assert.strictEqual(returned, undefined);
                returnedToCaller = true;
              });
              await new Promise<void>((resolve) => setImmediate(resolve));
              assert.strictEqual(notifications, 1);
              assert.strictEqual(asynchronous, true);
              assert.deepStrictEqual(values, [null]);
              assert.deepStrictEqual(await native.find({}).toArray(), before);
              assert.deepStrictEqual(await database.listCollections({ name: table }).toArray(), namespaces);
              const indexes = await native.listIndexes().toArray();
              for (const index of originalIndexes) assert.deepStrictEqual(indexes.find((entry) => entry.name === index.name), index);
              assert.deepStrictEqual(indexes.find((entry) => entry.name === '_id_')?.key, { _id: 1 });
              assert.deepStrictEqual(indexes.find((entry) => entry.name === 'id_1')?.key, { id: 1 });
              assert.deepStrictEqual(indexes.find((entry) => entry.name === 'name_1')?.key, { name: 1 });
              assert.deepStrictEqual(await relatedNative.find({}).toArray(), relatedRows);
              assert.deepStrictEqual(await relatedNative.listIndexes().toArray(), relatedIndexes, 'Ensuring a parent must not index its ordinary related collection');
              assert.deepStrictEqual(await database.listCollections({ name: relatedTable }).toArray(), relatedNamespaces);
              if (enabled) {
                assert.ok(typeof parentCache === 'object' && parentCache !== null);
                assert.ok(typeof relatedCache === 'object' && relatedCache !== null);
                assert.strictEqual(call(parentCache, 'get', [parent.id]), parent);
                assert.strictEqual(call(relatedCache, 'get', [related.id]), related);
              }
            }
            const relatedDb = call(Related, 'db');
            assert.ok(typeof relatedDb === 'object' && relatedDb !== null);
            await result((callback) => call(relatedDb, 'ensureSchema', [{}, callback]));
            const indexedRelated = await relatedNative.listIndexes().toArray();
            assert.deepStrictEqual(indexedRelated.find((entry) => entry.name === 'parent_id_1')?.key, { parent_id: 1 });
            assert.deepStrictEqual(await relatedNative.find({}).toArray(), relatedRows);
            const indexes = await native.listIndexes().toArray();
            const reset: unknown = Reflect.get(db, 'resetSchema');
            assert.ok(typeof reset === 'function');
            for (const route of ['direct', 'static']) {
              for (const options of [undefined, {}]) {
                const inserted = new Parent({ name: `${route} caller` });
                await save(inserted);
                assert.ok(await native.findOne({ _id: new ObjectId(String(inserted.id)) }));
                let notifications = 0;
                let returnedToCaller = false;
                let asynchronous = false;
                const values = await new Promise<unknown[]>((resolve) => {
                  const notify = (...args: unknown[]) => {
                    notifications++;
                    asynchronous = returnedToCaller;
                    resolve(args);
                  };
                  const args = options === undefined ? [notify] : [options, notify];
                  const returned: unknown = route === 'direct' ? Reflect.apply(reset, undefined, args) : call(Parent, 'resetSchema', args);
                  assert.strictEqual(returned, enabled && route === 'static' ? parentCache : undefined);
                  returnedToCaller = true;
                });
                await new Promise<void>((resolve) => setImmediate(resolve));
                assert.strictEqual(notifications, 1);
                assert.strictEqual(asynchronous, true);
                assert.deepStrictEqual(values, [null]);
                assert.deepStrictEqual(await native.find({}).toArray(), []);
                assert.deepStrictEqual(await native.listIndexes().toArray(), indexes);
                assert.deepStrictEqual(await database.listCollections({ name: table }).toArray(), namespaces);
                assert.deepStrictEqual(await relatedNative.find({}).toArray(), relatedRows);
                assert.deepStrictEqual(await relatedNative.listIndexes().toArray(), indexedRelated);
                assert.deepStrictEqual(await database.listCollections({ name: relatedTable }).toArray(), relatedNamespaces);
                assert.deepStrictEqual(await unrelated.find({}).toArray(), unrelatedRows);
                if (enabled) {
                  assert.ok(typeof parentCache === 'object' && parentCache !== null);
                  assert.ok(typeof relatedCache === 'object' && relatedCache !== null);
                  assert.strictEqual(call(parentCache, 'get', [inserted.id]), route === 'direct' ? inserted : undefined);
                  assert.strictEqual(call(relatedCache, 'get', [related.id]), related);
                }
              }
            }
            const retainedParent = new Parent({ name: 'retained belongsTo target' });
            await save(retainedParent);
            const parentRows = await native.find({}).toArray();
            for (const route of ['direct', 'static']) {
              const inserted = new Related({ name: `${route} belongsTo owner`, parent: retainedParent });
              await save(inserted);
              assert.ok(await relatedNative.findOne({ _id: new ObjectId(String(inserted.id)) }));
              let notifications = 0;
              let returnedToCaller = false;
              let asynchronous = false;
              const values = await new Promise<unknown[]>((resolve) => {
                const returned = call(route === 'direct' ? relatedDb : Related, 'resetSchema', [{}, (...args: unknown[]) => {
                  notifications++;
                  asynchronous = returnedToCaller;
                  resolve(args);
                }]);
                assert.strictEqual(returned, enabled && route === 'static' ? relatedCache : undefined);
                returnedToCaller = true;
              });
              await new Promise<void>((resolve) => setImmediate(resolve));
              assert.strictEqual(notifications, 1);
              assert.strictEqual(asynchronous, true);
              assert.deepStrictEqual(values, [null]);
              assert.deepStrictEqual(await relatedNative.find({}).toArray(), []);
              assert.deepStrictEqual(await relatedNative.listIndexes().toArray(), indexedRelated);
              assert.deepStrictEqual(await database.listCollections({ name: relatedTable }).toArray(), relatedNamespaces);
              assert.deepStrictEqual(await native.find({}).toArray(), parentRows);
              assert.deepStrictEqual(await native.listIndexes().toArray(), indexes);
              assert.deepStrictEqual(await database.listCollections({ name: table }).toArray(), namespaces);
              assert.deepStrictEqual(await unrelated.find({}).toArray(), unrelatedRows);
              if (enabled) {
                assert.ok(typeof parentCache === 'object' && parentCache !== null);
                assert.ok(typeof relatedCache === 'object' && relatedCache !== null);
                assert.strictEqual(call(parentCache, 'get', [retainedParent.id]), retainedParent);
                assert.strictEqual(call(relatedCache, 'get', [inserted.id]), route === 'direct' ? inserted : undefined);
              }
            }
          } catch (error: unknown) {
            failed = true;
            failure = error;
          } finally {
            try {
              await releaseRelations(controls);
            } catch (error: unknown) {
              cleanupErrors.push(error);
            }
            if (failed || cleanupErrors.length) {
              console.error('Outer relation schema failures:', inspect({ operationFailed: failed, operationFailure: failure, cleanupErrors }, { depth: null, maxArrayLength: null, maxStringLength: null, colors: false }));
              throw new AggregateError([...(failed ? [failure] : []), ...cleanupErrors], 'Outer relation schema operation/cleanup failed');
            }
          }
        });
      }

      it(`database tools outer schema retains real conflict effects and ordinary related owners (${cell})`, async () => {
        ORM.configure({ model_cache: { enabled, max: 100 } });
        const controls: ReturnType<typeof connection>[] = [];
        let failed = false;
        let failure: unknown;
        const cleanupErrors: unknown[] = [];
        try {
          for (const route of ['ensure', 'directReset', 'staticReset']) {
            const table = `${prefix}_outer_conflict_${route}`;
            const relatedTable = `${table}_related`;
            class Parent extends Backbone.Model {
              static model_name = 'Parent';
              urlRoot = `${server.uri}/${table}`;
              schema() {
                return { id: ['Integer', { indexed: true }], name: ['String', { indexed: true }], children: ['hasMany', Child, { as: 'parent' }] };
              }
            }
            class Child extends Backbone.Model {
              static model_name = 'Child';
              urlRoot = `${server.uri}/${relatedTable}`;
              schema() {
                return {};
              }
            }
            if (childFirst) Child.prototype.sync = Mongo.sync(Child);
            Parent.prototype.sync = Mongo.sync(Parent);
            Child.prototype.sync = Mongo.sync(Child);
            const owned = [connection(Parent), connection(Child)];
            controls.push(...owned);
            const database = server.client.db('production_port');
            const native = await database.createCollection(table, { validator: { name: { $type: 'string' } }, validationLevel: 'strict' });
            await native.createIndex({ name: 1 }, { unique: true });
            await native.createIndex({ sentinel: -1 }, { name: 'retained_custom' });
            const parent = new Parent({ name: 'survivor' });
            await save(parent);
            const child = new Child({ name: 'retained related', parent });
            await save(child);
            const related = database.collection(relatedTable);
            const rows = await native.find({}).toArray();
            const relatedRows = await related.find({}).toArray();
            assert.deepStrictEqual(rows.map(({ name, _rev }) => ({ name, _rev })), [{ name: 'survivor', _rev: 1 }]);
            assert.deepStrictEqual(relatedRows.map(({ name, parent_id, _rev }) => ({ name, parent_id, _rev })), [{ name: 'retained related', parent_id: parent.id, _rev: 1 }]);
            const indexes = await native.listIndexes().toArray();
            const relatedIndexes = await related.listIndexes().toArray();
            const namespaces = await database.listCollections({ name: table }).toArray();
            const relatedNamespaces = await database.listCollections({ name: relatedTable }).toArray();
            assert.ok(namespaces[0]?.info?.uuid);
            const original = await native.createIndex({ name: 1 }, { background: true }).then(() => undefined, (error: unknown) => error);
            assert.ok(original instanceof Error);
            const code: unknown = Reflect.get(original, 'code');
            assert.strictEqual(code, 86);
            const db = call(Parent, 'db');
            assert.ok(typeof db === 'object' && db !== null);
            const parentCache: unknown = Reflect.get(Parent, 'cache');
            const relatedCache: unknown = Reflect.get(Child, 'cache');
            let notifications = 0;
            let returnedToCaller = false;
            let asynchronous = false;
            const values = await new Promise<unknown[]>((resolve) => {
              const notify = (...args: unknown[]) => {
                notifications++;
                asynchronous = returnedToCaller;
                resolve(args);
              };
              const returned = route === 'staticReset' ? call(Parent, 'resetSchema', [{}, notify]) : call(db, route === 'ensure' ? 'ensureSchema' : 'resetSchema', [{}, notify]);
              assert.strictEqual(returned, enabled && route === 'staticReset' ? parentCache : undefined);
              returnedToCaller = true;
            });
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.strictEqual(notifications, 1);
            assert.strictEqual(asynchronous, true);
            assert.strictEqual(values.length, 1);
            assert.ok(values[0] instanceof Error);
            assert.strictEqual(values[0].message, 'Mongo ensureIndex failed');
            assert.strictEqual(Reflect.get(values[0], 'code'), code);
            assert.strictEqual(Reflect.get(values[0], 'cause'), undefined);
            assert.strictEqual(values[0].message.includes(table), false);
            if (enabled) {
              assert.ok(typeof parentCache === 'object' && parentCache !== null);
              assert.ok(typeof relatedCache === 'object' && relatedCache !== null);
              assert.strictEqual(call(parentCache, 'get', [parent.id]), route === 'staticReset' ? undefined : parent);
              assert.strictEqual(call(relatedCache, 'get', [child.id]), child);
            }
            const closed = await Promise.allSettled(owned.map(async (control) => control.destroy()));
            const errors = closed.filter((entry) => entry.status === 'rejected').map((entry) => entry.reason);
            if (errors.length) throw new AggregateError(errors, 'Outer conflict tracked-operation drain failed');
            const after = await native.listIndexes().toArray();
            for (const index of indexes) assert.deepStrictEqual(after.find((entry) => entry.name === index.name), index);
            assert.deepStrictEqual(after.find((entry) => entry.name === 'id_1')?.key, { id: 1 }, 'An index error retains other started native index writes');
            assert.deepStrictEqual(await native.find({}).toArray(), route === 'ensure' ? rows : [], 'A reset index error retains the completed clear');
            assert.deepStrictEqual(await database.listCollections({ name: table }).toArray(), namespaces);
            assert.deepStrictEqual(await related.find({}).toArray(), relatedRows);
            assert.deepStrictEqual(await related.listIndexes().toArray(), relatedIndexes);
            assert.deepStrictEqual(await database.listCollections({ name: relatedTable }).toArray(), relatedNamespaces);
          }
        } catch (error: unknown) {
          failed = true;
          failure = error;
        } finally {
          const closed = await Promise.allSettled(controls.map(async (control) => control.destroy()));
          cleanupErrors.push(...closed.filter((entry) => entry.status === 'rejected').map((entry) => entry.reason));
          ORM.configure({ model_cache: { enabled: false } });
          if (failed || cleanupErrors.length) {
            console.error('Outer conflict schema failures:', inspect({ operationFailed: failed, operationFailure: failure, cleanupErrors }, { depth: null, maxArrayLength: null, maxStringLength: null, colors: false }));
            throw new AggregateError([...(failed ? [failure] : []), ...cleanupErrors], 'Outer conflict schema operation/cleanup failed');
          }
        }
      });

      it(`persists and replaces native belongsTo/hasMany through final save callbacks (${cell})`, async () => {
        const { Parent, Child, controls } = relationTypes('persistence');
        try {
          const parent = new Parent({ name: 'parent' });
          const kept = new Child({ name: 'kept' });
          await save(parent);
          await save(kept);
          const removed = new Child({ name: 'removed', parent });
          await save(removed);
          assert.strictEqual(parent.get('_rev'), 1);
          parent.set('children', [kept]);
          await save(parent);
          const native = await collection(controls[1]);
          const keptRow = await native.findOne({ _id: new ObjectId(String(kept.id)) });
          const removedRow = await native.findOne({ _id: new ObjectId(String(removed.id)) });
          assert.ok(keptRow && removedRow);
          assert.strictEqual(keptRow.parent_id, parent.id);
          assert.strictEqual(typeof keptRow.parent_id, 'string');
          assert.strictEqual(keptRow._rev, 2);
          assert.strictEqual(removedRow.parent_id, null);
          assert.strictEqual(removedRow._rev, 2);
          assert.strictEqual(parent.get('_rev'), 2);
          assert.strictEqual(keptRow.children, undefined);
          const fresh = new Parent({ id: parent.id });
          await fetch(fresh);
          let childrenNotifications = 0;
          let returnedChildren: unknown;
          const children = await result((callback) => {
            returnedChildren = call(fresh, 'get', [
              'children',
              (error: unknown, value?: unknown) => {
                childrenNotifications += 1;
                callback(error, value);
              },
            ]);
          });
          await new Promise<void>((resolve) => setImmediate(resolve));
          assert.strictEqual(childrenNotifications, 1);
          assert.ok(returnedChildren instanceof Backbone.Collection);
          assert.strictEqual(children, returnedChildren.models);
          assert.ok(Array.isArray(children));
          assert.deepStrictEqual(
            children.map((child: Backbone.Model) => child.id),
            [kept.id]
          );
          const loadedChild = new Child({ id: kept.id });
          await fetch(loadedChild);
          let parentNotifications = 0;
          let returnedParent: unknown;
          const loadedParent = await result((callback) => {
            returnedParent = call(loadedChild, 'get', [
              'parent',
              (error: unknown, value?: unknown) => {
                parentNotifications += 1;
                callback(error, value);
              },
            ]);
          });
          await new Promise<void>((resolve) => setImmediate(resolve));
          assert.strictEqual(parentNotifications, 1);
          assert.ok(returnedParent instanceof Parent);
          assert.strictEqual(loadedParent, returnedParent);
          assert.ok(loadedParent instanceof Parent);
          assert.strictEqual(loadedParent.id, parent.id);
          await save(kept, { parent: null });
          assert.strictEqual((await native.findOne({ _id: new ObjectId(String(kept.id)) }))?.parent_id, null);
        } finally {
          await releaseRelations(controls);
        }
      });

      it(`fetches one-hop includes before projection and reuses ORM toModels identity (${cell})`, async () => {
        const { Parent, Child, controls } = relationTypes('includes');
        try {
          const parent = new Parent({ name: 'parent' });
          const empty = new Parent({ name: 'empty' });
          await save(parent);
          await save(empty);
          const first = new Child({ name: 'first', parent });
          const second = new Child({ name: 'second', parent });
          const orphan = new Child({ name: 'orphan' });
          await save(first);
          await save(second);
          await save(orphan);
          const query = Object.freeze({ id: parent.id, $include: Object.freeze(['children']), $select: Object.freeze(['name', 'children']) });
          const projected = await queryJSON(Parent, query);
          assert.ok(Array.isArray(projected));
          assert.strictEqual(projected.length, 1);
          const row: unknown = projected[0];
          assert.ok(typeof row === 'object' && row !== null);
          assert.deepStrictEqual(Object.keys(row).sort(), ['children', 'name']);
          const related: unknown = Reflect.get(row, 'children');
          assert.ok(Array.isArray(related));
          assert.deepStrictEqual(related.map((child) => child.name).sort(), ['first', 'second']);
          assert.strictEqual(await queryJSON(Parent, { id: parent.id, $include: ['children'], $count: true }), 1);
          assert.strictEqual(await queryJSON(Parent, { id: parent.id, $include: ['children'], $exists: true }), true);
          const page = await queryJSON(Parent, { id: parent.id, $include: ['children'], $page: true, $select: ['name'] });
          assert.deepStrictEqual(page, { offset: 0, total_rows: 1, rows: [{ name: 'parent' }] });
          const values = await queryJSON(Child, { id: first.id, $include: ['parent'], $values: ['name'] });
          assert.deepStrictEqual(values, ['first']);
          const scalar = await queryJSON(Child, { id: first.id, $include: ['parent'], $one: true, $select: ['name', 'parent'] });
          assert.ok(typeof scalar === 'object' && scalar !== null);
          const scalarParent: unknown = Reflect.get(scalar, 'parent');
          assert.ok(typeof scalarParent === 'object' && scalarParent !== null);
          assert.strictEqual(Reflect.get(scalarParent, 'id'), parent.id);
          const orphanJSON = await queryJSON(Child, { id: orphan.id, $include: ['parent'], $one: true });
          assert.ok(typeof orphanJSON === 'object' && orphanJSON !== null);
          assert.strictEqual(Reflect.get(orphanJSON, 'parent'), null);
          const emptyJSON = await queryJSON(Parent, { id: empty.id, $include: ['children'], $one: true });
          assert.ok(typeof emptyJSON === 'object' && emptyJSON !== null);
          assert.deepStrictEqual(Reflect.get(emptyJSON, 'children'), []);
          const models = await materialize(publicCursor(Child, { id: first.id, $include: ['parent'] }));
          const repeated = await materialize(publicCursor(Child, { id: first.id, $include: ['parent'] }));
          const relatedModel = models[0].get('parent');
          assert.ok(relatedModel instanceof Parent);
          assert.strictEqual(relatedModel.id, parent.id);
          if (enabled) {
            assert.strictEqual(relatedModel, parent);
            assert.strictEqual(repeated[0], models[0]);
            assert.strictEqual(repeated[0].get('parent'), relatedModel);
          }
          assert.deepStrictEqual(query, { id: parent.id, $include: ['children'], $select: ['name', 'children'] });
          await assert.rejects(queryJSON(Parent, { id: '000000000000000000000000', $include: ['children.parent'] }));
          await assert.rejects(queryJSON(Parent, { 'children.name': 'first' }));
          await assert.rejects(queryJSON(Parent, { $and: [{ 'children.name': 'first' }] }));
        } finally {
          await releaseRelations(controls);
        }
      });

      it(`keeps FK changes and pending unsets behind the existing revision CAS (${cell})`, async () => {
        const { Parent, Child, controls } = relationTypes('cas');
        try {
          const parent = new Parent({ name: 'parent' });
          await save(parent);
          const child = new Child({ name: 'first', remove: 'keep-until-success', parent });
          await save(child);
          const staleAttributes = child.toJSON();
          assert.strictEqual(staleAttributes._rev, 1);
          assert.strictEqual(staleAttributes.parent_id, parent.id);
          await save(child, { name: 'winner' });
          const native = await collection(controls[1]);
          let stored = await native.findOne({ _id: new ObjectId(String(child.id)) });
          assert.ok(stored);
          assert.strictEqual(stored.name, 'winner');
          assert.strictEqual(stored._rev, 2);
          assert.strictEqual(stored.parent_id, parent.id);
          assert.strictEqual(stored.remove, 'keep-until-success');
          const stale = new Child(staleAttributes);
          assert.strictEqual(stale.id, child.id);
          assert.strictEqual(stale.get('_rev'), 1);
          assert.strictEqual(stale.get('parent_id'), parent.id);
          stale.unset('remove');
          await assert.rejects(save(stale, { name: 'loser', parent: null }), /revision \(_rev\) was stale/);
          stored = await native.findOne({ _id: new ObjectId(String(child.id)) });
          assert.ok(stored);
          assert.strictEqual(stored._rev, 2);
          assert.strictEqual(stored.parent_id, parent.id);
          assert.strictEqual(stored.remove, 'keep-until-success');
          stale.set('_rev', 2);
          await save(stale);
          stored = await native.findOne({ _id: new ObjectId(String(child.id)) });
          assert.ok(stored);
          assert.strictEqual(stored._rev, 3);
          assert.strictEqual(stored.parent_id, null);
          assert.strictEqual(stored.remove, undefined);
          const parentRow = await (await collection(controls[0])).findOne({ _id: new ObjectId(String(parent.id)) });
          assert.ok(parentRow);
          assert.strictEqual(parentRow._rev, 1);
          assert.strictEqual(parent.get('_rev'), 1);
        } finally {
          await releaseRelations(controls);
        }
      });

      it(`keeps a reassigned serialized FK out of pending native unsets (${cell})`, async () => {
        const { Parent, Child, controls } = relationTypes('fk_unset');
        try {
          const parent = new Parent({ name: 'parent' });
          await save(parent);
          const replacement = new Parent({ name: 'replacement' });
          await save(replacement);
          const child = new Child({ name: 'child', parent });
          await save(child);
          child.unset('parent_id');
          assert.strictEqual(child.get('parent'), null);
          child.set('parent', replacement);
          assert.strictEqual(child.toJSON().parent_id, replacement.id);
          await save(child);
          const native = await collection(controls[1]);
          const row = await native.findOne({ _id: new ObjectId(String(child.id)) });
          assert.ok(row);
          assert.strictEqual(row.parent_id, replacement.id);
          assert.strictEqual(row._rev, 2);
          assert.strictEqual(parent.get('_rev'), 1);
          assert.strictEqual(call(ORM.Utils, 'get', [child, 'unsets']), undefined);
        } finally {
          await releaseRelations(controls);
        }
      });

      it(`reports native delete then failed child cleanup as a partial write (${cell})`, async () => {
        const { Parent, Child, controls } = relationTypes('partial');
        try {
          const parent = new Parent({ name: 'deleted' });
          const survivor = new Parent({ name: 'survivor' });
          await save(parent);
          await save(survivor);
          const child = new Child({ name: 'blocked', parent });
          const unrelated = new Child({ name: 'unrelated', parent: survivor });
          await save(child);
          await save(unrelated);
          const parentNative = await collection(controls[0]);
          const childNative = await collection(controls[1]);
          await server.client.db('production_port').command({ collMod: childNative.collectionName, validator: { parent_id: { $type: 'string' } }, validationLevel: 'strict', validationAction: 'error' });
          let notifications = 0;
          await assert.rejects(
            new Promise<void>((resolve, reject) => {
              const returned = parent.destroy({
                success() {
                  notifications += 1;
                  resolve();
                },
                error(_model, error: unknown) {
                  notifications += 1;
                  reject(error);
                },
              });
              assert.strictEqual(returned, undefined);
            }),
            (error: unknown) => error instanceof Error && Reflect.get(error, 'code') === 121
          );
          await new Promise<void>((resolve) => setImmediate(resolve));
          assert.strictEqual(notifications, 1);
          assert.strictEqual(await parentNative.findOne({ _id: new ObjectId(String(parent.id)) }), null);
          assert.ok(await parentNative.findOne({ _id: new ObjectId(String(survivor.id)) }));
          const failed = await childNative.findOne({ _id: new ObjectId(String(child.id)) });
          const untouched = await childNative.findOne({ _id: new ObjectId(String(unrelated.id)) });
          assert.ok(failed && untouched);
          assert.strictEqual(failed.parent_id, parent.id);
          assert.strictEqual(failed._rev, 1);
          assert.strictEqual(untouched.parent_id, survivor.id);
          assert.strictEqual(untouched._rev, 1);
        } finally {
          await releaseRelations(controls);
        }
      });

      it(`accepts an ORM-generated inverse and keeps the shared client until both leases close (${cell})`, async () => {
        const { Parent, Child, controls } = relationTypes('generated', true);
        try {
          assert.strictEqual(controls[0].url, controls[1].url);
          const parent = new Parent({ name: 'parent' });
          await save(parent);
          const schema = call(Child, 'schema');
          assert.ok(typeof schema === 'object' && schema !== null);
          const inverse = call(schema, 'relation', ['parent']);
          assert.ok(typeof inverse === 'object' && inverse !== null);
          assert.strictEqual(Reflect.get(inverse, 'type'), 'belongsTo');
          const child = new Child({ name: 'child', parent });
          await save(child);
          const client = ORM.ConnectionPool.get(controls[0].url);
          assert.ok(client instanceof MongoClient);
          await controls[0].destroy();
          assert.strictEqual(ORM.ConnectionPool.get(controls[1].url) === client, true);
          assert.deepStrictEqual(await queryNames(Child, { parent_id: parent.id }), ['child']);
          await controls[1].destroy();
          assert.strictEqual(ORM.ConnectionPool.get(controls[1].url), undefined);
        } finally {
          await releaseRelations(controls);
        }
      });

      it(`nulls stored child FKs on successful parent deletion and preserves unrelated rows (${cell})`, async () => {
        const { Parent, Child, controls } = relationTypes('delete');
        try {
          const parent = new Parent({ name: 'deleted' });
          const survivor = new Parent({ name: 'survivor' });
          await save(parent);
          await save(survivor);
          const child = new Child({ name: 'child', parent });
          const unrelated = new Child({ name: 'unrelated', parent: survivor });
          await save(child);
          await save(unrelated);
          await new Promise<void>((resolve, reject) => {
            const returned = parent.destroy({ success: () => resolve(), error: (_model, error: unknown) => reject(error) });
            assert.strictEqual(returned, undefined);
          });
          const parentNative = await collection(controls[0]);
          const childNative = await collection(controls[1]);
          assert.strictEqual(await parentNative.findOne({ _id: new ObjectId(String(parent.id)) }), null);
          assert.ok(await parentNative.findOne({ _id: new ObjectId(String(survivor.id)) }));
          const cleaned = await childNative.findOne({ _id: new ObjectId(String(child.id)) });
          const untouched = await childNative.findOne({ _id: new ObjectId(String(unrelated.id)) });
          assert.ok(cleaned && untouched);
          assert.strictEqual(cleaned.parent_id, null);
          assert.strictEqual(cleaned._rev, 2);
          assert.strictEqual(untouched.parent_id, survivor.id);
          assert.strictEqual(untouched._rev, 1);
        } finally {
          await releaseRelations(controls);
        }
      });

      for (const iteration of ['default', 'models']) {
        it(`static destroy cleans each selected parent's children and preserves survivors (${cell}, ${iteration})`, async () => {
          const { Parent, Child, controls } = relationTypes(`static_delete_${iteration}`);
          let failed = false;
          let failure: unknown;
          const cleanupErrors: unknown[] = [];
          try {
            const selected = [new Parent({ name: 'first' }), new Parent({ name: 'second' })];
            const survivor = new Parent({ name: 'survivor' });
            for (const parent of [...selected, survivor]) await save(parent);
            const children = selected.map((parent) => new Child({ name: `child_${parent.get('name')}`, parent }));
            const unrelated = new Child({ name: 'unrelated', parent: survivor });
            for (const child of [...children, unrelated]) await save(child);
            const parentNative = await collection(controls[0]);
            const childNative = await collection(controls[1]);
            const survivorBefore = await parentNative.findOne({ _id: new ObjectId(String(survivor.id)) });
            const unrelatedBefore = await childNative.findOne({ _id: new ObjectId(String(unrelated.id)) });
            const parentCache: unknown = Reflect.get(Parent, 'cache');
            const childCache: unknown = Reflect.get(Child, 'cache');
            if (enabled) {
              assert.ok(typeof parentCache === 'object' && parentCache !== null);
              assert.ok(typeof childCache === 'object' && childCache !== null);
              for (const parent of [...selected, survivor]) assert.strictEqual(call(parentCache, 'get', [parent.id]), parent);
              for (const child of [...children, unrelated]) assert.strictEqual(call(childCache, 'get', [child.id]), child);
            }
            const query = { $ids: selected.map((parent) => parent.id), ...(iteration === 'models' ? { $each: { json: false, threads: 1 } } : {}) };
            const queryBefore = { $ids: [...query.$ids], ...(query.$each ? { $each: { ...query.$each } } : {}) };
            let notifications = 0;
            let returnedToCaller = false;
            let asynchronous = false;
            const values = await new Promise<unknown[]>((resolve) => {
              const returned = call(Parent, 'destroy', [query, (...args: unknown[]) => {
                notifications += 1;
                asynchronous = returnedToCaller;
                resolve(args);
              }]);
              assert.strictEqual(returned, undefined);
              returnedToCaller = true;
            });
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.strictEqual(asynchronous, true);
            assert.strictEqual(notifications, 1);
            assert.deepStrictEqual(values, [null, 2]);
            assert.deepStrictEqual(query, queryBefore);
            assert.strictEqual(await parentNative.countDocuments(), 1);
            for (const parent of selected) assert.strictEqual(await parentNative.findOne({ _id: new ObjectId(String(parent.id)) }), null);
            assert.deepStrictEqual(await parentNative.findOne({ _id: new ObjectId(String(survivor.id)) }), survivorBefore);
            for (const child of children) {
              const row = await childNative.findOne({ _id: new ObjectId(String(child.id)) });
              assert.ok(row);
              assert.strictEqual(row.parent_id, null);
              assert.strictEqual(row._rev, 2);
              assert.strictEqual(row.name, child.get('name'));
              if (enabled) {
                assert.ok(typeof childCache === 'object' && childCache !== null);
                assert.strictEqual(call(childCache, 'get', [child.id]), child);
                assert.strictEqual(child.get('parent'), null);
                assert.strictEqual(child.get('_rev'), 2);
              }
            }
            assert.deepStrictEqual(await childNative.findOne({ _id: new ObjectId(String(unrelated.id)) }), unrelatedBefore);
            if (enabled) {
              assert.ok(typeof parentCache === 'object' && parentCache !== null);
              assert.ok(typeof childCache === 'object' && childCache !== null);
              for (const parent of selected) assert.strictEqual(call(parentCache, 'get', [parent.id]), undefined);
              assert.strictEqual(call(parentCache, 'get', [survivor.id]), survivor);
              assert.strictEqual(call(childCache, 'get', [unrelated.id]), unrelated);
            }
          } catch (error: unknown) {
            failed = true;
            failure = error;
          } finally {
            try {
              await releaseRelations(controls);
            } catch (error: unknown) {
              cleanupErrors.push(error);
            }
          }
          if (cleanupErrors.length) throw new AggregateError(failed ? [failure, ...cleanupErrors] : cleanupErrors, 'Static destroy relations operation/cleanup failed');
          if (failed) throw failure;
        });
      }

      it(`static destroy reports committed parent deletion and failed child cleanup (${cell})`, async () => {
        const { Parent, Child, controls } = relationTypes('static_partial');
        let failed = false;
        let failure: unknown;
        const cleanupErrors: unknown[] = [];
        try {
          const parent = new Parent({ name: 'deleted' });
          const survivor = new Parent({ name: 'survivor' });
          await save(parent);
          await save(survivor);
          const child = new Child({ name: 'blocked', parent });
          const unrelated = new Child({ name: 'unrelated', parent: survivor });
          await save(child);
          await save(unrelated);
          const parentNative = await collection(controls[0]);
          const childNative = await collection(controls[1]);
          const survivorBefore = await parentNative.findOne({ _id: new ObjectId(String(survivor.id)) });
          const childBefore = await childNative.findOne({ _id: new ObjectId(String(child.id)) });
          const unrelatedBefore = await childNative.findOne({ _id: new ObjectId(String(unrelated.id)) });
          await server.client.db('production_port').command({ collMod: childNative.collectionName, validator: { parent_id: { $type: 'string' } }, validationLevel: 'strict', validationAction: 'error' });
          let notifications = 0;
          let returnedToCaller = false;
          let asynchronous = false;
          const values = await new Promise<unknown[]>((resolve) => {
            const returned = call(Parent, 'destroy', [{ id: parent.id }, (...args: unknown[]) => {
              notifications += 1;
              asynchronous = returnedToCaller;
              resolve(args);
            }]);
            assert.strictEqual(returned, undefined);
            returnedToCaller = true;
          });
          await new Promise<void>((resolve) => setImmediate(resolve));
          assert.strictEqual(asynchronous, true);
          assert.strictEqual(notifications, 1);
          assert.strictEqual(values.length, 1);
          assert.ok(values[0] instanceof Error);
          assert.strictEqual(Reflect.get(values[0], 'code'), 121);
          assert.strictEqual(await parentNative.findOne({ _id: new ObjectId(String(parent.id)) }), null);
          assert.deepStrictEqual(await parentNative.findOne({ _id: new ObjectId(String(survivor.id)) }), survivorBefore);
          assert.deepStrictEqual(await childNative.findOne({ _id: new ObjectId(String(child.id)) }), childBefore);
          assert.deepStrictEqual(await childNative.findOne({ _id: new ObjectId(String(unrelated.id)) }), unrelatedBefore);
          if (enabled) {
            const cache: unknown = Reflect.get(Parent, 'cache');
            assert.ok(typeof cache === 'object' && cache !== null);
            assert.strictEqual(call(cache, 'get', [parent.id]), undefined);
            assert.strictEqual(call(cache, 'get', [survivor.id]), survivor);
          }
        } catch (error: unknown) {
          failed = true;
          failure = error;
        } finally {
          try {
            await releaseRelations(controls);
          } catch (error: unknown) {
            cleanupErrors.push(error);
          }
        }
        if (cleanupErrors.length) throw new AggregateError(failed ? [failure, ...cleanupErrors] : cleanupErrors, 'Static destroy partial-write operation/cleanup failed');
        if (failed) throw failure;
      });

      it(`rejects a replaced related sync before include, update or native deletion (${cell})`, async () => {
        const { Parent, Child, controls } = relationTypes('foreign');
        const childSync = Child.prototype.sync;
        class Foreign extends Backbone.Model {
          urlRoot = `${server.uri.replace('/production_port', '/relations_foreign')}/${prefix}_foreign_children`;
        }
        Foreign.prototype.sync = Mongo.sync(Foreign);
        const foreignControl = connection(Foreign);
        try {
          const parent = new Parent({ name: 'original' });
          await save(parent);
          const child = new Child({ name: 'child', parent });
          await save(child);
          const foreign = new Foreign({ id: child.id, name: 'foreign' });
          await save(foreign);
          const native = await collection(controls[0]);
          const before = await native.findOne({ _id: new ObjectId(String(parent.id)) });
          Child.prototype.sync = Foreign.prototype.sync;
          await assert.rejects(queryJSON(Parent, { id: '000000000000000000000000', $include: ['children'] }));
          await assert.rejects(save(parent, { name: 'blocked' }));
          await assert.rejects(
            new Promise<void>((resolve, reject) => {
              const returned = parent.destroy({ success: () => resolve(), error: (_model, error: unknown) => reject(error) });
              assert.strictEqual(returned, undefined);
            })
          );
          assert.deepStrictEqual(await native.findOne({ _id: new ObjectId(String(parent.id)) }), before);
          const foreignRow = await (await collection(foreignControl)).findOne({ _id: new ObjectId(String(child.id)) });
          assert.ok(foreignRow);
          assert.strictEqual(foreignRow.name, 'foreign');
          assert.strictEqual(foreignRow._rev, 1);
        } finally {
          Child.prototype.sync = childSync;
          await releaseRelations([...controls, foreignControl]);
        }
      });

      it(`rejects unsupported relation shapes and retains failed factory readiness (${cell})`, async () => {
        ORM.configure({ model_cache: { enabled, max: 100 } });
        try {
          for (const variant of ['one_inverse', 'pivot', 'embedded', 'virtual', 'self', 'reserved_fk', 'dotted_fk']) {
            const badTable = `${prefix}_unsupported_${variant}_parents`;
            class Target extends Backbone.Model {
              static model_name = 'Target';
              urlRoot = `${server.uri}/${prefix}_unsupported_${variant}_targets`;
              schema() {
                return variant === 'pivot' ? { parents: ['hasMany', Bad, { as: 'targets' }] } : variant === 'one_inverse' ? { bad: ['hasOne', Bad, { as: 'target' }] } : {};
              }
            }
            class Bad extends Backbone.Model {
              static model_name = 'Bad';
              urlRoot = `${server.uri}/${badTable}`;
              schema() {
                if (variant === 'self') return { parent: ['belongsTo', Bad] };
                if (variant === 'one_inverse') return { target: ['hasOne', Target, { as: 'bad' }] };
                if (variant === 'pivot') return { targets: ['hasMany', Target, { as: 'parents' }] };
                if (variant === 'reserved_fk') return { target: ['belongsTo', Target, { foreign_key: '_rev' }] };
                if (variant === 'dotted_fk') return { target: ['belongsTo', Target, { foreign_key: 'target.id' }] };
                return { target: ['belongsTo', Target, variant === 'embedded' ? { embed: true } : { virtual: true }] };
              }
            }
            let failure: Error | undefined;
            assert.throws(
              () => Mongo.sync(Bad),
              (error: unknown) => {
                if (!(error instanceof Error)) return false;
                failure = error;
                return true;
              }
            );
            assert.ok(failure);
            assert.throws(
              () => Mongo.sync(Bad),
              (error: unknown) => error === failure
            );
            if (variant !== 'self') {
              assert.throws(
                () => Mongo.sync(Target),
                (error: unknown) => error === failure
              );
              await assert.rejects(queryJSON(Target, {}));
            }
            await assert.rejects(queryJSON(Bad, {}));
            const db = call(Bad, 'db');
            assert.ok(typeof db === 'object' && db !== null);
            for (const operation of [{ host: db, method: 'ensureSchema' }, { host: db, method: 'resetSchema' }, { host: Bad, method: 'resetSchema' }]) {
              let notifications = 0;
              let returnedToCaller = false;
              let asynchronous = false;
              const values = await new Promise<unknown[]>((resolve) => {
                const returned = call(operation.host, operation.method, [{}, (...args: unknown[]) => {
                  notifications++;
                  asynchronous = returnedToCaller;
                  resolve(args);
                }]);
                assert.strictEqual(returned, undefined);
                returnedToCaller = true;
              });
              await new Promise<void>((resolve) => setImmediate(resolve));
              assert.strictEqual(notifications, 1);
              assert.strictEqual(asynchronous, true);
              assert.deepStrictEqual(values, [failure]);
            }
            assert.strictEqual(await server.client.db('production_port').collection(badTable).countDocuments(), 0);
            const namespaces = await server.client.db('production_port').listCollections({ name: badTable }).toArray();
            assert.deepStrictEqual(namespaces, []);
          }
        } finally {
          ORM.configure({ model_cache: { enabled: false } });
        }
      });

      it(`rejects initial foreign database, adapter and options without replacing the related owner (${cell})`, async () => {
        ORM.configure({ model_cache: { enabled, max: 100 } });
        try {
          for (const variant of ['database', 'adapter', 'options']) {
            class Target extends Backbone.Model {
              static model_name = 'Target';
              urlRoot = `${variant === 'database' ? server.uri.replace('/production_port', '/relations_foreign') : server.uri}/${prefix}_initial_${variant}_targets`;
            }
            Target.prototype.sync = variant === 'adapter' ? ORM.sync(Target) : Mongo.sync(Target, variant === 'options' ? { appName: 'different-owner-options' } : {});
            const original = Target.prototype.sync;
            const targetControl = variant === 'adapter' ? undefined : connection(Target);
            class Parent extends Backbone.Model {
              static model_name = 'Parent';
              urlRoot = `${server.uri}/${prefix}_initial_${variant}_parents`;
              schema() {
                return { target: ['belongsTo', Target] };
              }
            }
            try {
              assert.throws(() => Mongo.sync(Parent));
              assert.strictEqual(Target.prototype.sync, original);
              assert.strictEqual(await server.client.db('production_port').collection(`${prefix}_initial_${variant}_parents`).countDocuments(), 0);
            } finally {
              if (targetControl) await targetControl.destroy();
            }
          }
        } finally {
          ORM.configure({ model_cache: { enabled: false } });
        }
      });

      it(`keeps flat manual zero usable after rejecting manual relation admission (${cell})`, async () => {
        ORM.configure({ model_cache: { enabled, max: 100 } });
        class Manual extends Backbone.Model {
          static model_name = 'Manual';
          urlRoot = `${server.uri}/${prefix}_manual_boundary`;
          schema() {
            return { id: ['Integer', { manual: true }] };
          }
        }
        Manual.prototype.sync = Mongo.sync(Manual);
        const control = connection(Manual);
        class Native extends Backbone.Model {
          urlRoot = `${server.uri}/${prefix}_manual_boundary_native`;
          schema() {
            return { owner: ['belongsTo', Manual] };
          }
        }
        try {
          const zero = new Manual({ id: 0, name: 'first' });
          await save(zero);
          assert.throws(() => Mongo.sync(Native));
          await save(zero, { name: 'second' });
          assert.deepStrictEqual(await queryJSON(Manual, { id: 0, $one: true }), { id: 0, name: 'second', _rev: 2 });
          const rows = await materialize(publicCursor(Manual, { id: 0 }));
          assert.strictEqual(rows[0].id, 0);
          if (enabled) assert.strictEqual(rows[0], zero);
        } finally {
          await releaseRelations([control]);
        }
      });

      it(`refuses queued native work after provisional schema initialization fails (${cell})`, async () => {
        ORM.configure({ model_cache: { enabled, max: 100 } });
        const table = `${prefix}_failed_queued`;
        let notifications = 0;
        let outcome: Promise<unknown> | undefined;
        class Target extends Backbone.Model {
          static model_name = 'Target';
          urlRoot = `${server.uri}/${prefix}_failed_queued_targets`;
        }
        class Queued extends Backbone.Model {
          static model_name = 'Queued';
          urlRoot = `${server.uri}/${table}`;
          schema() {
            return {
              queued: () => {
                outcome = result((callback) =>
                  call(Queued.prototype, 'sync', [
                    'create',
                    new Backbone.Model({ name: 'must-not-write' }),
                    {
                      success(value: unknown) {
                        notifications += 1;
                        callback(null, value);
                      },
                      error(error: unknown) {
                        notifications += 1;
                        callback(error);
                      },
                    },
                  ])
                ).then(
                  (value) => value,
                  (error: unknown) => error
                );
                return 'String';
              },
              broken: ['hasOne', Target, { virtual: true }],
            };
          }
        }
        try {
          let failure: Error | undefined;
          assert.throws(
            () => Mongo.sync(Queued),
            (error: unknown) => {
              if (!(error instanceof Error)) return false;
              failure = error;
              return true;
            }
          );
          assert.ok(failure && outcome);
          assert.strictEqual(await outcome, failure);
          assert.strictEqual(notifications, 1);
          assert.throws(
            () => Mongo.sync(Queued),
            (error: unknown) => error === failure
          );
          assert.strictEqual(await server.client.db('production_port').collection(table).countDocuments(), 0);
          class Unrelated extends Backbone.Model {
            urlRoot = `${server.uri}/${prefix}_after_failed_queued`;
          }
          Unrelated.prototype.sync = Mongo.sync(Unrelated);
          const unrelatedControl = connection(Unrelated);
          try {
            await save(new Unrelated({ name: 'unrelated-still-ready' }));
            assert.deepStrictEqual(await queryNames(Unrelated, {}), ['unrelated-still-ready']);
          } finally {
            await unrelatedControl.destroy();
          }
        } finally {
          ORM.configure({ model_cache: { enabled: false } });
        }
      });

      it(`validates effective logical relation predicates after cursor precedence (${cell})`, async () => {
        const { Parent, Child, controls } = relationTypes('logical');
        try {
          const alpha = new Parent({ name: 'alpha', profile: { children: { name: 'literal-data' } } });
          const beta = new Parent({ name: 'beta' });
          await save(alpha);
          await save(beta);
          await save(new Child({ name: 'child', parent: alpha }));
          assert.deepStrictEqual(await queryNames(Parent, { profile: { children: { name: 'literal-data' } } }), ['alpha']);
          for (const operator of ['$and', '$or', '$nor']) {
            const query = Object.freeze({
              find: Object.freeze({ [operator]: Object.freeze([Object.freeze({ 'children.name': 'unsupported-overwritten' })]) }),
              cursor: Object.freeze({ [operator]: Object.freeze([Object.freeze({ name: 'alpha' })]), $include: Object.freeze(['children']), $sort: 'name' }),
            });
            const expected = operator === '$nor' ? ['beta'] : ['alpha'];
            assert.deepStrictEqual(await queryNames(Parent, query), expected);
            assert.strictEqual(await queryJSON(Parent, { find: query.find, cursor: { ...query.cursor, $count: true } }), 1);
            await assert.rejects(
              queryJSON(Parent, {
                find: { [operator]: [{ name: 'alpha' }] },
                cursor: { [operator]: [{ 'children.name': 'effective-unsupported' }] },
              })
            );
            assert.deepStrictEqual(query.find[operator], [{ 'children.name': 'unsupported-overwritten' }]);
          }
        } finally {
          await releaseRelations(controls);
        }
      });

      it(`rejects closed related leases for includes and mutations while flat sibling reads survive (${cell})`, async () => {
        const { Parent, Child, controls } = relationTypes('closed');
        try {
          const parent = new Parent({ name: 'unchanged' });
          await save(parent);
          await save(new Child({ name: 'child', parent }));
          const native = await collection(controls[0]);
          const before = await native.findOne({ _id: new ObjectId(String(parent.id)) });
          await controls[1].destroy();
          for (const flags of [{}, { $count: true }, { $exists: true }, { $zero: true }]) {
            await assert.rejects(queryJSON(Parent, { id: '000000000000000000000000', $include: ['children'], ...flags }));
          }
          await assert.rejects(save(parent, { name: 'blocked' }));
          await assert.rejects(
            new Promise<void>((resolve, reject) => {
              const returned = parent.destroy({ success: () => resolve(), error: (_model, error: unknown) => reject(error) });
              assert.strictEqual(returned, undefined);
            })
          );
          assert.deepStrictEqual(await native.findOne({ _id: new ObjectId(String(parent.id)) }), before);
          assert.deepStrictEqual(await queryNames(Parent, { id: parent.id }), ['unchanged']);
        } finally {
          await releaseRelations(controls);
        }
      });

      it(`rejects invalid FK JSON saves before changing the stored child (${cell})`, async () => {
        const { Parent, Child, controls } = relationTypes('invalid_fk');
        try {
          const parent = new Parent({ name: 'parent' });
          await save(parent);
          const child = new Child({ name: 'child', parent });
          await save(child);
          const native = await collection(controls[1]);
          const before = await native.findOne({ _id: new ObjectId(String(child.id)) });
          const json = await queryJSON(Child, { id: child.id, $one: true });
          assert.ok(typeof json === 'object' && json !== null);
          for (const invalid of [0, new ObjectId(String(parent.id)), 'not-an-id', 'ABCDEFABCDEFABCDEFABCDEFAB', { id: parent.id }, [parent.id]]) {
            await assert.rejects(result((callback) => call(ORM.Utils, 'modelJSONSave', [{ ...json, parent_id: invalid }, Child, callback])));
            assert.deepStrictEqual(await native.findOne({ _id: new ObjectId(String(child.id)) }), before);
          }
          await assert.rejects(save(child, { parent_id: 'not-an-id' }));
          assert.deepStrictEqual(await native.findOne({ _id: new ObjectId(String(child.id)) }), before);
          assert.deepStrictEqual(await queryNames(Child, { parent_id: { $in: [parent.id] } }), ['child']);
        } finally {
          await releaseRelations(controls);
        }
      });

      it(`rejects stale cleanup JSON through ORM's actual relation save owner (${cell})`, async () => {
        const { Parent, Child, controls } = relationTypes('cleanup_cas');
        try {
          const parent = new Parent({ name: 'parent' });
          await save(parent);
          const child = new Child({ name: 'before', parent });
          await save(child);
          const staleJSON = await queryJSON(Child, { id: child.id, $one: true });
          assert.ok(typeof staleJSON === 'object' && staleJSON !== null);
          await save(child, { name: 'winner' });
          await assert.rejects(result((callback) => call(ORM.Utils, 'modelJSONSave', [{ ...staleJSON, parent_id: null }, Child, callback])));
          const stored = await (await collection(controls[1])).findOne({ _id: new ObjectId(String(child.id)) });
          assert.ok(stored);
          assert.strictEqual(stored.parent_id, parent.id);
          assert.strictEqual(stored.name, 'winner');
          assert.strictEqual(stored._rev, 2);
          assert.strictEqual((await (await collection(controls[0])).findOne({ _id: new ObjectId(String(parent.id)) }))?._rev, 1);
        } finally {
          await releaseRelations(controls);
        }
      });

      it(`observes parent success, wrapped child failure and cleared relation retry intent (${cell})`, async () => {
        const { Parent, Child, controls } = relationTypes('save_partial');
        try {
          const parent = new Parent({ name: 'parent' });
          await save(parent);
          const child = new Child({ name: 'blocked', parent });
          await save(child);
          const native = await collection(controls[1]);
          await server.client.db('production_port').command({ collMod: native.collectionName, validator: { parent_id: { $type: 'string' } }, validationLevel: 'strict', validationAction: 'error' });
          let notifications = 0;
          const failure = await new Promise<unknown>((resolve) => {
            const returned = parent.save(
              { children: [] },
              {
                success() {
                  notifications += 1;
                  resolve('unexpected-success');
                },
                error(_model, error: unknown) {
                  notifications += 1;
                  resolve(error);
                },
              }
            );
            assert.strictEqual(returned, undefined);
          });
          assert.ok(failure instanceof Error);
          assert.match(failure.message, /Failed to save relations/);
          await new Promise<void>((resolve) => setImmediate(resolve));
          assert.strictEqual(notifications, 1);
          const parentRow = await (await collection(controls[0])).findOne({ _id: new ObjectId(String(parent.id)) });
          const childRow = await native.findOne({ _id: new ObjectId(String(child.id)) });
          assert.ok(parentRow && childRow);
          assert.strictEqual(parentRow._rev, 2);
          assert.strictEqual(childRow._rev, 1);
          assert.strictEqual(childRow.parent_id, parent.id);
          const dirty = call(ORM.Utils, 'get', [parent, 'rel_dirty']);
          assert.ok(typeof dirty === 'object' && dirty !== null);
          assert.strictEqual(Reflect.getOwnPropertyDescriptor(dirty, 'children'), undefined);
          const loadedChildren = parent.get('children');
          assert.ok(loadedChildren instanceof Backbone.Collection);
          assert.strictEqual(loadedChildren.length, 0);
          assert.strictEqual(child.get('parent'), null);
          await server.client.db('production_port').command({ collMod: native.collectionName, validator: {} });
          await save(parent);
          assert.strictEqual((await native.findOne({ _id: new ObjectId(String(child.id)) }))?.parent_id, parent.id);
        } finally {
          await releaseRelations(controls);
        }
      });

      it(`observes the unsaved foreign belongsTo presave before rejecting the child adapter write (${cell})`, async () => {
        const { Parent, Child, controls } = relationTypes('unsaved_foreign');
        const parentSync = Parent.prototype.sync;
        class Foreign extends Backbone.Model {
          urlRoot = `${server.uri.replace('/production_port', '/relations_foreign')}/${prefix}_presaved_foreign`;
        }
        Foreign.prototype.sync = Mongo.sync(Foreign);
        const foreignControl = connection(Foreign);
        try {
          Parent.prototype.sync = Foreign.prototype.sync;
          const unsaved = new Parent({ name: 'foreign-presave-observation' });
          const child = new Child({ name: 'blocked-child', parent: unsaved });
          await assert.rejects(save(child));
          assert.match(String(unsaved.id), /^[0-9a-f]{24}$/);
          const foreignRow = await (await collection(foreignControl)).findOne({ _id: new ObjectId(String(unsaved.id)) });
          assert.ok(foreignRow);
          assert.strictEqual(foreignRow.name, 'foreign-presave-observation');
          assert.strictEqual(foreignRow._rev, 1);
          assert.strictEqual(child.id, undefined);
          assert.strictEqual(await server.client.db('production_port').collection(`${prefix}_unsaved_foreign_children`).countDocuments(), 0);
          assert.strictEqual(await server.client.db('production_port').collection(`${prefix}_unsaved_foreign_parents`).countDocuments(), 0);
        } finally {
          Parent.prototype.sync = parentSync;
          await releaseRelations([...controls, foreignControl]);
        }
      });

      it(`keeps a real pool replacement alive when a relation create handshake loses ownership (${cell})`, async () => {
        const { Parent, controls } = relationTypes('pool_replaced');
        const replacement = new MongoClient(server.uri);
        try {
          await replacement.connect();
          let notifications = 0;
          const outcome = result((callback) =>
            call(Parent.prototype, 'sync', [
              'create',
              new Backbone.Model({ name: 'blocked-create' }),
              {
                success(value: unknown) {
                  notifications += 1;
                  callback(null, value);
                },
                error(error: unknown) {
                  notifications += 1;
                  callback(error);
                },
              },
            ])
          ).then(
            (value) => value,
            (error: unknown) => error
          );
          await Promise.resolve();
          const original = ORM.ConnectionPool.get(controls[0].url);
          assert.ok(original instanceof MongoClient);
          original.once('topologyOpening', () => {
            ORM.ConnectionPool.del(controls[0].url);
            ORM.ConnectionPool.set(controls[0].url, replacement);
          });
          assert.ok((await outcome) instanceof Error);
          assert.strictEqual(notifications, 1);
          assert.strictEqual(await server.client.db('production_port').collection(`${prefix}_pool_replaced_parents`).countDocuments(), 0);
          await releaseRelations(controls);
          assert.strictEqual(ORM.ConnectionPool.get(controls[0].url) === replacement, true);
          assert.strictEqual(await replacement.db('production_port').collection(`${prefix}_replacement_probe`).countDocuments(), 0);
        } finally {
          if (ORM.ConnectionPool.get(controls[0].url) === replacement) ORM.ConnectionPool.del(controls[0].url);
          try {
            await releaseRelations(controls);
          } finally {
            await replacement.close();
          }
        }
      });

      it(`rechecks a related lease closed during the parent native handshake (${cell})`, async () => {
        const { Parent, controls } = relationTypes('handshake_related_closed');
        let released: Promise<void> | undefined;
        let notifications = 0;
        try {
          const outcome = result((callback) =>
            call(Parent.prototype, 'sync', [
              'create',
              new Backbone.Model({ name: 'must-not-write' }),
              {
                success(value: unknown) {
                  notifications += 1;
                  callback(null, value);
                },
                error(error: unknown) {
                  notifications += 1;
                  callback(error);
                },
              },
            ])
          ).then(
            (value) => value,
            (error: unknown) => error
          );
          await Promise.resolve();
          const client = ORM.ConnectionPool.get(controls[0].url);
          assert.ok(client instanceof MongoClient);
          client.once('topologyOpening', () => {
            released = controls[1].destroy();
          });
          const error = await outcome;
          assert.ok(error instanceof Error);
          assert.match(error.message, /closed/);
          assert.ok(released);
          await released;
          assert.strictEqual(notifications, 1);
          assert.strictEqual(await server.client.db('production_port').collection(`${prefix}_handshake_related_closed_parents`).countDocuments(), 0);
        } finally {
          try {
            await released;
          } finally {
            await releaseRelations(controls);
          }
        }
      });
    }
  }

  it('invalidates new relation targets created through either native entry when the outer schema fails', async () => {
    const esm = (await import('backbone-mongo')).default;
    const required: unknown = createRequire(path.join(repository, 'package.json'))('backbone-mongo');
    assert.ok(typeof required === 'object' && required !== null);
    assert.strictEqual(Reflect.get(required, 'Backbone'), esm.Backbone);
    assert.strictEqual(esm.Backbone, Backbone);
    assert.notStrictEqual(Reflect.get(required, 'sync'), esm.sync, 'Regression requires distinct native CJS and ESM factories');
    const entries = [
      { name: 'esm', api: esm },
      { name: 'cjs', api: required },
    ];
    for (const enabled of [false, true]) {
      for (const root of entries) {
        for (const crossEntry of [false, true]) {
          const nested = crossEntry ? entries.find((entry) => entry !== root) : root;
          assert.ok(nested);
          const prefix = `mixed_failure_${enabled ? 'on' : 'off'}_${root.name}_${crossEntry ? 'cross' : 'same'}`;
          const controls: MongoConnectionControl[] = [];
          let failed = false;
          let failure: unknown;
          const cleanupErrors: unknown[] = [];
          class Bridge extends Backbone.Model {
            static model_name = 'Bridge';
            urlRoot = `${server.uri}/${prefix}_bridges`;
          }
          class Nested extends Backbone.Model {
            static model_name = 'Nested';
            urlRoot = `${server.uri}/${prefix}_targets`;
          }
          class Unsupported extends Backbone.Model {
            static model_name = 'Unsupported';
            urlRoot = `${server.uri}/${prefix}_unsupported`;
          }
          let created: unknown;
          let nestedControl: MongoConnectionControl | undefined;
          class Outer extends Backbone.Model {
            static model_name = 'Outer';
            urlRoot = `${server.uri}/${prefix}_outers`;
            schema() {
              return {
                bootstrap: () => {
                  controls.push(connection(Outer));
                  created = call(Bridge, 'createSync', [Nested]);
                  nestedControl = connection(Nested);
                  controls.push(nestedControl);
                  return 'String';
                },
                target: ['belongsTo', Nested],
                broken: ['hasOne', Unsupported, { virtual: true }],
              };
            }
          }
          try {
            ORM.configure({ model_cache: { enabled, max: 100 } });
            call(nested.api, 'sync', [Bridge]);
            controls.push(connection(Bridge));
            let configurationFailure: Error | undefined;
            assert.throws(
              () => call(root.api, 'sync', [Outer]),
              (error: unknown) => {
                if (!(error instanceof Error)) return false;
                configurationFailure = error;
                return true;
              }
            );
            assert.ok(configurationFailure);
            assert.strictEqual(typeof created, 'function', 'Actual ORM createSync must have completed the nested target');
            assert.ok(nestedControl);
            assert.throws(
              () => call(root.api, 'sync', [Outer]),
              (error: unknown) => error === configurationFailure
            );
            let notifications = 0;
            const outcome = await result((callback) =>
              call(Nested.prototype, 'sync', [
                'create',
                new Backbone.Model({ name: 'must-not-write' }),
                {
                  success(value: unknown) {
                    notifications += 1;
                    callback(null, value);
                  },
                  error(error: unknown) {
                    notifications += 1;
                    callback(error);
                  },
                },
              ])
            ).then(
              (value) => value,
              (error: unknown) => error
            );
            await save(new Bridge({ name: 'pre-existing-owner-still-ready' }));
            assert.strictEqual(notifications, 1);
            const count = await server.client.db('production_port').collection(`${prefix}_targets`).countDocuments();
            assert.strictEqual(outcome, configurationFailure, 'New target must inherit its failed outer initialization batch');
            assert.strictEqual(count, 0);
            for (const entry of entries)
              assert.throws(
                () => call(entry.api, 'sync', [Nested]),
                (error: unknown) => error === configurationFailure
              );
          } catch (error: unknown) {
            failed = true;
            failure = error;
          } finally {
            for (const control of controls) {
              try {
                await control.destroy();
              } catch (error: unknown) {
                cleanupErrors.push(error);
              }
            }
            try {
              ORM.configure({ model_cache: { enabled: false } });
            } catch (error: unknown) {
              cleanupErrors.push(error);
            }
          }
          if (cleanupErrors.length) throw new AggregateError(failed ? [failure, ...cleanupErrors] : cleanupErrors, 'Mixed-entry operation/cleanup failed');
          if (failed) throw failure;
        }
      }
    }
  });

  it('completes valid back-references through either native entry before persistence and includes', async () => {
    const esm = (await import('backbone-mongo')).default;
    const required: unknown = createRequire(path.join(repository, 'package.json'))('backbone-mongo');
    assert.ok(typeof required === 'object' && required !== null);
    assert.strictEqual(Reflect.get(required, 'Backbone'), esm.Backbone);
    assert.strictEqual(esm.Backbone, Backbone);
    assert.notStrictEqual(Reflect.get(required, 'sync'), esm.sync, 'Regression requires distinct native CJS and ESM factories');
    const entries = [
      { name: 'esm', api: esm },
      { name: 'cjs', api: required },
    ];
    for (const enabled of [false, true]) {
      for (const root of entries) {
        for (const crossEntry of [false, true]) {
          const nested = crossEntry ? entries.find((entry) => entry !== root) : root;
          assert.ok(nested);
          const prefix = `mixed_valid_${enabled ? 'on' : 'off'}_${root.name}_${crossEntry ? 'cross' : 'same'}`;
          const controls: MongoConnectionControl[] = [];
          let failed = false;
          let failure: unknown;
          const cleanupErrors: unknown[] = [];
          class Bridge extends Backbone.Model {
            static model_name = 'Bridge';
            urlRoot = `${server.uri}/${prefix}_bridges`;
          }
          class Nested extends Backbone.Model {
            static model_name = 'Nested';
            urlRoot = `${server.uri}/${prefix}_children`;
            schema() {
              return { parent: ['belongsTo', Outer, { as: 'children' }] };
            }
          }
          let created: unknown;
          let nestedControl: MongoConnectionControl | undefined;
          class Outer extends Backbone.Model {
            static model_name = 'Outer';
            urlRoot = `${server.uri}/${prefix}_parents`;
            schema() {
              return {
                bootstrap: () => {
                  controls.push(connection(Outer));
                  assert.strictEqual(call(Bridge, 'createSync', [Outer]), Outer.prototype.sync);
                  created = call(Bridge, 'createSync', [Nested]);
                  nestedControl = connection(Nested);
                  controls.push(nestedControl);
                  return 'String';
                },
                children: ['hasMany', Nested, { as: 'parent' }],
              };
            }
          }
          try {
            ORM.configure({ model_cache: { enabled, max: 100 } });
            call(nested.api, 'sync', [Bridge]);
            controls.push(connection(Bridge));
            call(root.api, 'sync', [Outer]);
            assert.strictEqual(typeof created, 'function');
            assert.ok(nestedControl);
            for (const entry of entries) {
              assert.strictEqual(call(entry.api, 'sync', [Outer]), Outer.prototype.sync);
              assert.strictEqual(call(entry.api, 'sync', [Nested]), Nested.prototype.sync);
            }
            const parent = new Outer({ name: 'parent' });
            await save(parent);
            const child = new Nested({ name: 'child', parent });
            await save(child);
            const row = await (await collection(nestedControl)).findOne({ _id: new ObjectId(String(child.id)) });
            assert.ok(row);
            assert.ok(row._id instanceof ObjectId);
            assert.strictEqual(row.parent_id, parent.id);
            assert.strictEqual(typeof row.parent_id, 'string');
            assert.strictEqual(row._rev, 1);
            const included = await queryJSON(Outer, { id: parent.id, $one: true, $include: ['children'] });
            assert.ok(typeof included === 'object' && included !== null);
            const children: unknown = Reflect.get(included, 'children');
            assert.ok(Array.isArray(children));
            assert.deepStrictEqual(
              children.map((value) => Reflect.get(value, 'id')),
              [child.id]
            );
            const models = await materialize(publicCursor(Nested, { id: child.id, $include: ['parent'] }));
            const related = models[0].get('parent');
            assert.ok(related instanceof Outer);
            assert.strictEqual(related.id, parent.id);
            if (enabled) assert.strictEqual(related, parent);
            await save(new Bridge({ name: 'pre-existing-owner-still-ready' }));
          } catch (error: unknown) {
            failed = true;
            failure = error;
          } finally {
            for (const control of controls) {
              try {
                await control.destroy();
              } catch (error: unknown) {
                cleanupErrors.push(error);
              }
            }
            try {
              ORM.configure({ model_cache: { enabled: false } });
            } catch (error: unknown) {
              cleanupErrors.push(error);
            }
          }
          if (cleanupErrors.length) throw new AggregateError(failed ? [failure, ...cleanupErrors] : cleanupErrors, 'Mixed-entry back-reference operation/cleanup failed');
          if (failed) throw failure;
        }
      }
    }
  });

  it('keeps caught nested configuration failures terminal while independent native owners succeed', async () => {
    const esm = (await import('backbone-mongo')).default;
    const required: unknown = createRequire(path.join(repository, 'package.json'))('backbone-mongo');
    assert.ok(typeof required === 'object' && required !== null);
    assert.strictEqual(Reflect.get(required, 'Backbone'), esm.Backbone);
    assert.strictEqual(esm.Backbone, Backbone);
    assert.notStrictEqual(Reflect.get(required, 'sync'), esm.sync, 'Regression requires distinct native CJS and ESM factories');
    const entries = [
      { name: 'esm', api: esm },
      { name: 'cjs', api: required },
    ];
    for (const enabled of [false, true]) {
      for (const root of entries) {
        for (const crossEntry of [false, true]) {
          const nested = crossEntry ? entries.find((entry) => entry !== root) : root;
          assert.ok(nested);
          const prefix = `mixed_caught_${enabled ? 'on' : 'off'}_${root.name}_${crossEntry ? 'cross' : 'same'}`;
          const controls: MongoConnectionControl[] = [];
          let failed = false;
          let failure: unknown;
          const cleanupErrors: unknown[] = [];
          let configurationFailure: Error | undefined;
          let created: unknown;
          class Bridge extends Backbone.Model {
            static model_name = 'Bridge';
            urlRoot = `${server.uri}/${prefix}_bridges`;
          }
          class InvalidNested extends Backbone.Model {
            static model_name = 'InvalidNested';
            urlRoot = `${server.uri}/${prefix}_invalid`;
            schema() {
              return {
                bootstrap: () => {
                  controls.push(connection(InvalidNested));
                  return 'String';
                },
                parent: ['belongsTo', InvalidNested],
              };
            }
          }
          class Independent extends Backbone.Model {
            static model_name = 'Independent';
            urlRoot = `${server.uri}/${prefix}_independent`;
            schema() {
              return {
                bootstrap: () => {
                  controls.push(connection(Independent));
                  return 'String';
                },
              };
            }
          }
          class Outer extends Backbone.Model {
            static model_name = 'Outer';
            urlRoot = `${server.uri}/${prefix}_outers`;
            schema() {
              return {
                bootstrap: () => {
                  controls.push(connection(Outer));
                  try {
                    call(Bridge, 'createSync', [InvalidNested]);
                  } catch (error: unknown) {
                    assert.ok(error instanceof Error);
                    configurationFailure = error;
                  }
                  assert.ok(configurationFailure, 'Unsupported self relation must fail inside the outer schema');
                  created = call(Bridge, 'createSync', [Independent]);
                  return 'String';
                },
              };
            }
          }
          try {
            ORM.configure({ model_cache: { enabled, max: 100 } });
            call(nested.api, 'sync', [Bridge]);
            controls.push(connection(Bridge));
            call(root.api, 'sync', [Outer]);
            assert.ok(configurationFailure);
            assert.strictEqual(typeof created, 'function', 'An independent nested owner must complete after the caught failure');
            for (const entry of entries) {
              assert.throws(
                () => call(entry.api, 'sync', [InvalidNested]),
                (error: unknown) => error === configurationFailure
              );
              assert.strictEqual(call(entry.api, 'sync', [Outer]), Outer.prototype.sync);
              assert.strictEqual(call(entry.api, 'sync', [Independent]), Independent.prototype.sync);
              assert.strictEqual(call(entry.api, 'sync', [Bridge]), Bridge.prototype.sync);
            }
            await assert.rejects(
              () => queryJSON(InvalidNested, {}),
              (error: unknown) => error === configurationFailure
            );
            let notifications = 0;
            const outcome = await result((callback) =>
              call(InvalidNested.prototype, 'sync', [
                'create',
                new Backbone.Model({ name: 'must-not-write' }),
                {
                  success(value: unknown) {
                    notifications += 1;
                    callback(null, value);
                  },
                  error(error: unknown) {
                    notifications += 1;
                    callback(error);
                  },
                },
              ])
            ).then(
              (value) => value,
              (error: unknown) => error
            );
            await save(new Outer({ name: 'outer-ready' }));
            await save(new Independent({ name: 'independent-ready' }));
            await save(new Bridge({ name: 'pre-existing-owner-ready' }));
            assert.strictEqual(notifications, 1);
            assert.strictEqual(outcome, configurationFailure);
            assert.strictEqual(await server.client.db('production_port').collection(`${prefix}_invalid`).countDocuments(), 0);
            assert.deepStrictEqual(await queryNames(Outer, {}), ['outer-ready']);
            assert.deepStrictEqual(await queryNames(Independent, {}), ['independent-ready']);
            assert.deepStrictEqual(await queryNames(Bridge, {}), ['pre-existing-owner-ready']);
          } catch (error: unknown) {
            failed = true;
            failure = error;
          } finally {
            for (const control of controls) {
              try {
                await control.destroy();
              } catch (error: unknown) {
                cleanupErrors.push(error);
              }
            }
            try {
              ORM.configure({ model_cache: { enabled: false } });
            } catch (error: unknown) {
              cleanupErrors.push(error);
            }
          }
          if (cleanupErrors.length) throw new AggregateError(failed ? [failure, ...cleanupErrors] : cleanupErrors, 'Caught nested configuration operation/cleanup failed');
          if (failed) throw failure;
        }
      }
    }
  });

  it('uses one Backbone and preserves callback returns, native ids and atomic revision writes', async () => {
    await exerciseMongoCrud(server.uri);
  });

  it('keeps manual zero, real collection reads and cursor shapes without mutating queries', async () => {
    class Manual extends Backbone.Model {
      urlRoot = `${server.uri}/manual_items`;
      schema() {
        return { id: ['Integer', { manual: true }] };
      }
    }
    Manual.prototype.sync = Mongo.sync(Manual);
    class Items extends Backbone.Collection<Manual> {}
    Items.prototype.model = Manual;
    Items.prototype.sync = Mongo.sync(Items);
    const control = connection(Manual);
    try {
      const zero = new Manual({ id: 0, name: 'zero', score: 10 });
      const one = new Manual({ id: 1, name: 'one', score: 20 });
      await save(zero);
      await save(one);
      const loaded = new Manual({ id: 0 });
      await fetch(loaded);
      assert.deepStrictEqual(loaded.toJSON(), { id: 0, name: 'zero', score: 10, _rev: 1 });
      const duplicate = new Manual({ id: 0 });
      // Manual IDs have no implicit unique index in this bounded slice.
      assert.strictEqual(duplicate.isNew(), false);
      const rows = new Items();
      await fetch(rows);
      assert.deepStrictEqual(rows.pluck('id'), [0, 1]);
      const query = { $sort: ['-score'], $offset: 1, $limit: 1, $select: ['id', 'name'] };
      const cursor = call(Manual, 'cursor', [query]);
      assert.ok(cursor && typeof cursor === 'object');
      assert.deepStrictEqual(await result((cb) => call(cursor, 'toJSON', [cb])), [{ id: 0, name: 'zero' }]);
      assert.deepStrictEqual(query, { $sort: ['-score'], $offset: 1, $limit: 1, $select: ['id', 'name'] });
      for (const [controlName, expected] of [
        ['$count', 2],
        ['$exists', true],
      ] as const) {
        const controlled = call(Manual, 'cursor', [{ [controlName]: true }]);
        assert.ok(controlled && typeof controlled === 'object');
        assert.strictEqual(await result((cb) => call(controlled, 'toJSON', [cb])), expected);
      }
      const scalar = call(Manual, 'cursor', [0]);
      assert.ok(scalar && typeof scalar === 'object');
      assert.deepStrictEqual(await result((cb) => call(scalar, 'toJSON', [cb])), loaded.toJSON());
      const missing = call(Manual, 'cursor', [{ id: 99, $one: true }]);
      assert.ok(missing && typeof missing === 'object');
      assert.strictEqual(await result((cb) => call(missing, 'toJSON', [cb])), null);
    } finally {
      await control.destroy();
    }
  });

  for (const enabled of [false, true]) {
    for (const manual of [false, true]) {
      const cell = `cache ${enabled ? 'on' : 'off'}, ${manual ? 'manual zero' : 'native ObjectId'}`;
      const table = `materialized_${enabled ? 'on' : 'off'}_${manual ? 'manual' : 'native'}`;

      function modelType(phase: string) {
        ORM.configure({ model_cache: { enabled, max: 100 } });
        class Item extends Backbone.Model<MaterializedAttributes> {
          urlRoot = `${server.uri}/${table}_${phase}`;
          schema() {
            return manual ? { id: ['Integer', { manual: true }] } : {};
          }
        }
        Item.prototype.sync = Mongo.sync(Item);
        return Item;
      }

      it(`database tools preserve native and literal indexes without changing rows (${cell})`, async () => {
        ORM.configure({ model_cache: { enabled, max: 100 } });
        const indexTable = `${table}_database_indexes`;
        class Indexed extends Backbone.Model {
          urlRoot = `${server.uri}/${indexTable}`;
          schema() {
            return { id: ['Integer', { indexed: true, ...(manual ? { manual: true } : {}) }], name: ['String', { indexed: true }] };
          }
        }
        Indexed.prototype.sync = Mongo.sync(Indexed);
        const control = connection(Indexed);
        let failed = false;
        let failure: unknown;
        const cleanupErrors: unknown[] = [];
        try {
          const native = server.client.db('production_port').collection(indexTable);
          const saved = new Indexed({ name: 'original', ...(manual ? { id: 0 } : {}) });
          await save(saved);
          await native.createIndex({ payload: -1 }, { name: 'retained_custom' });
          const custom = (await native.listIndexes().toArray()).find((index) => index.name === 'retained_custom');
          const db = call(Indexed, 'db');
          assert.ok(typeof db === 'object' && db !== null);
          assert.strictEqual(call(Indexed, 'db'), db);
          const before = await native.find({}).sort({ _id: 1 }).toArray();
          const create: unknown = Reflect.get(db, 'createOrUpdateTable');
          assert.ok(typeof create === 'function');
          assert.deepStrictEqual(before.map(({ name, _rev }) => ({ name, _rev })), [{ name: 'original', _rev: 1 }]);
          if (manual) assert.strictEqual(before[0].id, 0);
          let notifications = 0;
          let returnedToCaller = false;
          let asynchronous = false;
          const values = await new Promise<unknown[]>((resolve) => {
            const returned: unknown = Reflect.apply(create, undefined, [{}, (...args: unknown[]) => {
              notifications++;
              asynchronous = returnedToCaller;
              resolve(args);
            }]);
            assert.strictEqual(returned, undefined);
            returnedToCaller = true;
          });
          await new Promise<void>((resolve) => setImmediate(resolve));
          assert.strictEqual(notifications, 1);
          assert.strictEqual(asynchronous, true);
          assert.deepStrictEqual(values, [null]);
          assert.deepStrictEqual(await native.find({}).sort({ _id: 1 }).toArray(), before);
          const indexes = await native.listIndexes().toArray();
          assert.deepStrictEqual(indexes.find((index) => index.name === '_id_')?.key, { _id: 1 });
          assert.deepStrictEqual(indexes.find((index) => index.name === 'id_1')?.key, { id: 1 });
          assert.deepStrictEqual(indexes.find((index) => index.name === 'name_1')?.key, { name: 1 });
          assert.notStrictEqual(indexes.find((index) => index.name === 'id_1')?.unique, true);
          assert.deepStrictEqual(indexes.find((index) => index.name === 'retained_custom'), custom);
          if (manual) {
            assert.strictEqual(saved.id, 0);
            await native.insertOne({ id: 0, name: 'duplicate', _rev: 11 });
            assert.strictEqual(await native.countDocuments({ id: 0 }), 2);
          } else {
            assert.strictEqual(before[0].id, undefined);
            assert.ok(before[0]._id instanceof ObjectId);
          }
          const duplicateRows = await native.find({}).sort({ _id: 1 }).toArray();
          await result((callback) => call(db, 'createOrUpdateTable', [{}, callback]));
          assert.deepStrictEqual(await native.find({}).sort({ _id: 1 }).toArray(), duplicateRows);
          assert.deepStrictEqual(await native.listIndexes().toArray(), indexes);
          const ensure: unknown = Reflect.get(db, 'ensureIndex');
          assert.ok(typeof ensure === 'function');
          for (const options of [undefined, {}]) {
            notifications = 0;
            returnedToCaller = false;
            asynchronous = false;
            const args = await new Promise<unknown[]>((resolve) => {
              const notify = (...values: unknown[]) => {
                notifications++;
                asynchronous = returnedToCaller;
                resolve(values);
              };
              const returned: unknown = Reflect.apply(ensure, undefined, options === undefined ? ['payload.id', notify] : ['payload.id', options, notify]);
              assert.strictEqual(returned, undefined);
              returnedToCaller = true;
            });
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.strictEqual(notifications, 1);
            assert.strictEqual(asynchronous, true);
            assert.deepStrictEqual(args, []);
            const after = await native.listIndexes().toArray();
            assert.deepStrictEqual(after.find((index) => index.name === 'payload.id_1')?.key, { 'payload.id': 1 });
            for (const index of indexes) assert.deepStrictEqual(after.find((entry) => entry.name === index.name), index);
            assert.deepStrictEqual(await native.find({}).sort({ _id: 1 }).toArray(), duplicateRows);
          }
          if (enabled) {
            const cache: unknown = Reflect.get(Indexed, 'cache');
            assert.ok(typeof cache === 'object' && cache !== null);
            assert.strictEqual(call(cache, 'get', [saved.id]), saved);
          }
        } catch (error: unknown) {
          failed = true;
          failure = error;
        } finally {
          const closed = await Promise.allSettled([control.destroy()]);
          cleanupErrors.push(...closed.filter((entry) => entry.status === 'rejected').map((entry) => entry.reason));
          ORM.configure({ model_cache: { enabled: false } });
          if (failed || cleanupErrors.length) {
            console.error('Database indexing failures:', inspect({ operationFailed: failed, operationFailure: failure, cleanupErrors }, { depth: null, maxArrayLength: null, maxStringLength: null, colors: false }));
            throw new AggregateError([...(failed ? [failure] : []), ...cleanupErrors], 'Database indexing operation/cleanup failed');
          }
        }
      });

      it(`database tools outer schema overloads preserve native and manual identity (${cell})`, async () => {
        ORM.configure({ model_cache: { enabled, max: 100 } });
        const outerTable = `${table}_outer_identity`;
        class Item extends Backbone.Model {
          urlRoot = `${server.uri}/${outerTable}`;
          schema() {
            return { id: ['Integer', { indexed: true, ...(manual ? { manual: true } : {}) }], name: ['String', { indexed: true }] };
          }
        }
        Item.prototype.sync = Mongo.sync(Item);
        const control = connection(Item);
        let failed = false;
        let failure: unknown;
        const cleanupErrors: unknown[] = [];
        try {
          const database = server.client.db('production_port');
          const native = await database.createCollection(outerTable, { validator: { name: { $type: 'string' } }, validationLevel: 'strict' });
          await native.createIndex({ sentinel: -1 }, { name: 'retained_custom' });
          const saved = new Item({ name: 'retained before ensure', ...(manual ? { id: 0 } : {}) });
          await save(saved);
          if (manual) {
            await native.insertOne({ id: 0, name: 'duplicate manual zero', _rev: 9 });
            assert.strictEqual(await native.countDocuments({ id: 0 }), 2);
          }
          const before = await native.find({}).sort({ _id: 1 }).toArray();
          const namespaces = await database.listCollections({ name: outerTable }).toArray();
          assert.ok(namespaces[0]?.info?.uuid);
          const originalIndexes = await native.listIndexes().toArray();
          const db = call(Item, 'db');
          assert.ok(typeof db === 'object' && db !== null);
          assert.strictEqual(call(Item, 'db'), db);
          const ensure: unknown = Reflect.get(db, 'ensureSchema');
          assert.ok(typeof ensure === 'function');
          const cache: unknown = Reflect.get(Item, 'cache');
          for (const options of [undefined, {}]) {
            let notifications = 0;
            let returnedToCaller = false;
            let asynchronous = false;
            const values = await new Promise<unknown[]>((resolve) => {
              const notify = (...args: unknown[]) => {
                notifications++;
                asynchronous = returnedToCaller;
                resolve(args);
              };
              const returned: unknown = Reflect.apply(ensure, undefined, options === undefined ? [notify] : [options, notify]);
              assert.strictEqual(returned, undefined);
              returnedToCaller = true;
            });
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.strictEqual(notifications, 1);
            assert.strictEqual(asynchronous, true);
            assert.deepStrictEqual(values, [null]);
            assert.deepStrictEqual(await native.find({}).sort({ _id: 1 }).toArray(), before);
            assert.deepStrictEqual(await database.listCollections({ name: outerTable }).toArray(), namespaces);
            const indexes = await native.listIndexes().toArray();
            for (const index of originalIndexes) assert.deepStrictEqual(indexes.find((entry) => entry.name === index.name), index);
            assert.deepStrictEqual(indexes.find((entry) => entry.name === '_id_')?.key, { _id: 1 });
            assert.deepStrictEqual(indexes.find((entry) => entry.name === 'id_1')?.key, { id: 1 });
            assert.deepStrictEqual(indexes.find((entry) => entry.name === 'name_1')?.key, { name: 1 });
            assert.notStrictEqual(indexes.find((entry) => entry.name === 'id_1')?.unique, true);
            if (enabled) {
              assert.ok(typeof cache === 'object' && cache !== null);
              assert.strictEqual(call(cache, 'get', [saved.id]), saved);
            }
          }
          const indexes = await native.listIndexes().toArray();
          const reset: unknown = Reflect.get(db, 'resetSchema');
          assert.ok(typeof reset === 'function');
          for (const route of ['direct', 'static']) {
            for (const options of [undefined, {}]) {
              await native.insertOne({ name: 'new row before each destructive reset', _rev: 7, ...(manual ? { id: 0 } : {}) });
              assert.ok(await native.countDocuments());
              let notifications = 0;
              let returnedToCaller = false;
              let asynchronous = false;
              const values = await new Promise<unknown[]>((resolve) => {
                const notify = (...args: unknown[]) => {
                  notifications++;
                  asynchronous = returnedToCaller;
                  resolve(args);
                };
                const args = options === undefined ? [notify] : [options, notify];
                const returned: unknown = route === 'direct' ? Reflect.apply(reset, undefined, args) : call(Item, 'resetSchema', args);
                assert.strictEqual(returned, enabled && route === 'static' ? cache : undefined);
                returnedToCaller = true;
              });
              await new Promise<void>((resolve) => setImmediate(resolve));
              assert.strictEqual(notifications, 1);
              assert.strictEqual(asynchronous, true);
              assert.deepStrictEqual(values, [null]);
              assert.deepStrictEqual(await native.find({}).toArray(), []);
              assert.deepStrictEqual(await native.listIndexes().toArray(), indexes);
              assert.deepStrictEqual(await database.listCollections({ name: outerTable }).toArray(), namespaces);
              if (enabled) {
                assert.ok(typeof cache === 'object' && cache !== null);
                assert.strictEqual(call(cache, 'get', [saved.id]), route === 'direct' ? saved : undefined);
              }
            }
          }
        } catch (error: unknown) {
          failed = true;
          failure = error;
        } finally {
          const closed = await Promise.allSettled([control.destroy()]);
          cleanupErrors.push(...closed.filter((entry) => entry.status === 'rejected').map((entry) => entry.reason));
          ORM.configure({ model_cache: { enabled: false } });
          if (failed || cleanupErrors.length) {
            console.error('Outer identity schema failures:', inspect({ operationFailed: failed, operationFailure: failure, cleanupErrors }, { depth: null, maxArrayLength: null, maxStringLength: null, colors: false }));
            throw new AggregateError([...(failed ? [failure] : []), ...cleanupErrors], 'Outer identity schema operation/cleanup failed');
          }
        }
      });

      it(`database tools report a real index conflict and retain partial index effects (${cell})`, async () => {
        ORM.configure({ model_cache: { enabled, max: 100 } });
        const indexTable = `${table}_database_conflict`;
        class Conflict extends Backbone.Model {
          urlRoot = `${server.uri}/${indexTable}`;
          schema() {
            return { id: ['Integer', { indexed: true, ...(manual ? { manual: true } : {}) }], name: ['String', { indexed: true }] };
          }
        }
        Conflict.prototype.sync = Mongo.sync(Conflict);
        const control = connection(Conflict);
        let failed = false;
        let failure: unknown;
        const cleanupErrors: unknown[] = [];
        try {
          const native = server.client.db('production_port').collection(indexTable);
          const saved = new Conflict({ name: 'survivor', ...(manual ? { id: 0 } : {}) });
          await save(saved);
          await native.createIndex({ name: 1 }, { unique: true });
          await native.createIndex({ sentinel: -1 }, { name: 'retained_custom' });
          const before = await native.find({}).toArray();
          const indexes = await native.listIndexes().toArray();
          const nativeFailure = await native.createIndex({ name: 1 }, { background: true }).then(() => undefined, (error: unknown) => error);
          assert.deepStrictEqual(before.map(({ name, _rev }) => ({ name, _rev })), [{ name: 'survivor', _rev: 1 }]);
          assert.ok(nativeFailure instanceof Error, 'The independent native request must establish an actual index-options conflict');
          const code: unknown = Reflect.get(nativeFailure, 'code');
          assert.strictEqual(typeof code, 'number');
          const db = call(Conflict, 'db');
          assert.ok(typeof db === 'object' && db !== null);
          let notifications = 0;
          let returnedToCaller = false;
          let asynchronous = false;
          const values = await new Promise<unknown[]>((resolve) => {
            const returned = call(db, 'createOrUpdateTable', [{}, (...args: unknown[]) => {
              notifications++;
              asynchronous = returnedToCaller;
              resolve(args);
            }]);
            assert.strictEqual(returned, undefined);
            returnedToCaller = true;
          });
          await new Promise<void>((resolve) => setImmediate(resolve));
          assert.strictEqual(notifications, 1);
          assert.strictEqual(asynchronous, true);
          assert.strictEqual(values.length, 1);
          assert.ok(values[0] instanceof Error);
          assert.strictEqual(values[0].message, 'Mongo ensureIndex failed');
          assert.strictEqual(Reflect.get(values[0], 'code'), code);
          assert.strictEqual(Reflect.get(values[0], 'cause'), undefined);
          assert.strictEqual(values[0].message.includes(indexTable), false);
          await control.destroy();
          const after = await native.listIndexes().toArray();
          for (const index of indexes) assert.deepStrictEqual(after.find((entry) => entry.name === index.name), index);
          assert.deepStrictEqual(after.find((index) => index.name === 'id_1')?.key, { id: 1 }, 'A failed index task does not roll back other started index writes');
          assert.deepStrictEqual(await native.find({}).toArray(), before);
          if (enabled) {
            const cache: unknown = Reflect.get(Conflict, 'cache');
            assert.ok(typeof cache === 'object' && cache !== null);
            assert.strictEqual(call(cache, 'get', [saved.id]), saved);
          }
        } catch (error: unknown) {
          failed = true;
          failure = error;
        } finally {
          const closed = await Promise.allSettled([control.destroy()]);
          cleanupErrors.push(...closed.filter((entry) => entry.status === 'rejected').map((entry) => entry.reason));
          ORM.configure({ model_cache: { enabled: false } });
          if (failed || cleanupErrors.length) {
            console.error('Database conflict failures:', inspect({ operationFailed: failed, operationFailure: failure, cleanupErrors }, { depth: null, maxArrayLength: null, maxStringLength: null, colors: false }));
            throw new AggregateError([...(failed ? [failure] : []), ...cleanupErrors], 'Database conflict operation/cleanup failed');
          }
        }
      });

      it(`materializes repeated public find/toModels with intended identity (${cell})`, async () => {
        const Item = modelType('identity');
        const control = connection(Item);
        try {
          const saved = new Item({ name: 'first', ...(manual ? { id: 0 } : {}) });
          await save(saved);
          if (manual) assert.strictEqual(saved.id, 0);
          else assert.match(String(saved.id), /^[0-9a-f]{24}$/);
          const native = await collection(control);
          const stored = await native.findOne(manual ? { id: 0 } : { _id: new ObjectId(String(saved.id)) });
          assert.ok(stored);
          assert.strictEqual(stored.name, 'first');
          const cursor = publicCursor(Item, { id: saved.id });
          const first = await materialize(cursor);
          const second = await materialize(cursor);
          const found = await findModels(Item, { id: saved.id });
          const repeated = await findModels(Item, { id: saved.id });
          for (const models of [first, second, found, repeated]) {
            assert.strictEqual(models.length, 1);
            assert.ok(models[0] instanceof Item);
            assert.deepStrictEqual(models[0].toJSON(), { id: saved.id, name: 'first', _rev: 1 });
          }
          if (enabled) {
            assert.strictEqual(first[0], saved, 'Cache-on first materialization must reuse saved model');
            assert.strictEqual(second[0], first[0], 'Cache-on repeated toModels must reuse canonical model');
            assert.strictEqual(found[0], first[0]);
            assert.strictEqual(repeated[0], first[0]);
          } else {
            assert.notStrictEqual(first[0], saved);
            assert.notStrictEqual(second[0], first[0]);
            assert.notStrictEqual(found[0], first[0]);
            assert.notStrictEqual(repeated[0], found[0]);
          }
        } finally {
          ORM.configure({ model_cache: { enabled: false } });
          await control.destroy();
          assert.strictEqual(ORM.ConnectionPool.get(control.url), undefined);
        }
      });

      it(`keeps saved and explicitly forced fetched values fresh (${cell})`, async () => {
        const Item = modelType('freshness');
        const control = connection(Item);
        try {
          const saved = new Item({ name: 'first', ...(manual ? { id: 0 } : {}) });
          await save(saved);
          await save(saved, { name: 'saved' });
          assert.strictEqual(saved.get('_rev'), 2);
          const afterSave = await findModels(Item, { id: saved.id });
          assert.strictEqual(afterSave.length, 1);
          assert.strictEqual(afterSave[0].get('name'), 'saved');
          assert.strictEqual(afterSave[0].get('_rev'), 2);
          const fetched = new Item({ id: saved.id });
          await fetch(fetched);
          assert.deepStrictEqual(fetched.toJSON(), { id: saved.id, name: 'saved', _rev: 2 });
          const native = await collection(control);
          const updated = await native.updateOne(manual ? { id: 0 } : { _id: new ObjectId(String(saved.id)) }, { $set: { name: 'native-update', _rev: 3 } });
          assert.strictEqual(updated.matchedCount, 1);
          let notifications = 0;
          await new Promise<void>((resolve, reject) => {
            const options = {
              force: true,
              success() {
                notifications += 1;
                resolve();
              },
              error(_model: unknown, error: unknown) {
                notifications += 1;
                reject(error);
              },
            };
            const returned: unknown = saved.fetch(options);
            assert.strictEqual(returned, undefined);
          });
          assert.strictEqual(notifications, 1);
          assert.deepStrictEqual(saved.toJSON(), { id: saved.id, name: 'native-update', _rev: 3 });
          const refreshed = await materialize(publicCursor(Item, { id: saved.id }));
          assert.strictEqual(refreshed.length, 1);
          assert.deepStrictEqual(refreshed[0].toJSON(), saved.toJSON());
          if (enabled) assert.strictEqual(refreshed[0], saved, 'Cache-on forced fetch must retain canonical materialization');
          else assert.notStrictEqual(refreshed[0], saved);
        } finally {
          ORM.configure({ model_cache: { enabled: false } });
          await control.destroy();
          assert.strictEqual(ORM.ConnectionPool.get(control.url), undefined);
        }
      });

      it(`static destroy preserves selector, count and callback contracts (${cell})`, async () => {
        ORM.configure({ model_cache: { enabled, max: 100 } });
        const constructed: Backbone.Model[] = [];
        class Item extends Backbone.Model<MaterializedAttributes & { payload?: { id: string } }> {
          urlRoot = `${server.uri}/${table}_static_selection`;
          schema() {
            return manual ? { id: ['Integer', { manual: true }] } : {};
          }
          initialize() {
            constructed.push(this);
          }
        }
        Item.prototype.sync = Mongo.sync(Item);
        const control = connection(Item);
        let failed = false;
        let failure: unknown;
        const cleanupErrors: unknown[] = [];
        try {
          const scalar = new Item({ name: 'scalar', ...(manual ? { id: 0 } : {}) });
          const queried = new Item({ name: 'queried', ...(manual ? { id: 1 } : {}) });
          const survivor = new Item({ name: 'survivor', ...(manual ? { id: 2 } : {}) });
          await save(scalar);
          await save(queried, { payload: { id: 'literal-data' } });
          await save(survivor);
          const native = await collection(control);
          const idFilter = (model: Backbone.Model) => manual ? { id: model.id } : { _id: new ObjectId(String(model.id)) };
          const survivorBefore = await native.findOne(idFilter(survivor));
          const queriedBefore = await native.findOne(idFilter(queried));
          const cache: unknown = Reflect.get(Item, 'cache');
          if (enabled) {
            assert.ok(typeof cache === 'object' && cache !== null);
            for (const model of [scalar, queried, survivor]) assert.strictEqual(call(cache, 'get', [model.id]), model);
          }
          const cases = [
            { query: scalar.id, count: 1, removed: scalar },
            { query: { $and: [{ id: { $in: [queried.id] } }, { payload: { id: 'literal-data' } }], $each: { json: false, threads: 1 } }, count: 1, removed: queried },
            { query: { name: 'missing' }, count: 0, removed: undefined },
          ];
          for (const scenario of cases) {
            constructed.length = 0;
            let notifications = 0;
            let returnedToCaller = false;
            let asynchronous = false;
            const values = await new Promise<unknown[]>((resolve) => {
              const returned = call(Item, 'destroy', [scenario.query, (...args: unknown[]) => {
                notifications += 1;
                asynchronous = returnedToCaller;
                resolve(args);
              }]);
              assert.strictEqual(returned, undefined);
              returnedToCaller = true;
            });
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.strictEqual(asynchronous, true);
            assert.strictEqual(notifications, 1);
            assert.deepStrictEqual(values, [null, scenario.count]);
            if (!enabled && scenario.removed === scalar) assert.deepStrictEqual(constructed, [], 'Default adapter iteration uses JSON records');
            if (!enabled && scenario.removed === queried) {
              assert.strictEqual(constructed.length, 1, 'Caller json:false must materialize the selected model');
              assert.ok(constructed[0] instanceof Item);
              assert.strictEqual(constructed[0].id, queried.id);
              assert.strictEqual(constructed[0].get('name'), 'queried');
              assert.deepStrictEqual(constructed[0].get('payload'), { id: 'literal-data' });
            }
            if (scenario.removed) {
              assert.strictEqual(await native.findOne(idFilter(scenario.removed)), null);
              if (enabled) {
                assert.ok(typeof cache === 'object' && cache !== null);
                assert.strictEqual(call(cache, 'get', [scenario.removed.id]), undefined);
              }
            }
            if (scenario.removed === scalar) assert.deepStrictEqual(await native.findOne(idFilter(queried)), queriedBefore);
            assert.deepStrictEqual(await native.findOne(idFilter(survivor)), survivorBefore);
            if (enabled) {
              assert.ok(typeof cache === 'object' && cache !== null);
              assert.strictEqual(call(cache, 'get', [survivor.id]), survivor);
            }
          }
          if (manual) {
            await native.insertMany([{ id: 9, name: 'duplicate_first', _rev: 1 }, { id: 9, name: 'duplicate_second', _rev: 4 }]);
            assert.strictEqual(await native.countDocuments({ id: 9 }), 2);
            let notifications = 0;
            const values = await new Promise<unknown[]>((resolve) => {
              const returned = call(Item, 'destroy', [{ id: 9, $limit: 1 }, (...args: unknown[]) => {
                notifications += 1;
                resolve(args);
              }]);
              assert.strictEqual(returned, undefined);
            });
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.strictEqual(notifications, 1);
            assert.deepStrictEqual(values, [null, 1], 'Iteration count is independent of the two native rows removed by ID');
            assert.strictEqual(await native.countDocuments({ id: 9 }), 0);
            assert.deepStrictEqual(await native.findOne(idFilter(survivor)), survivorBefore);
          }
          assert.strictEqual(await native.countDocuments(), 1);
          let notifications = 0;
          let returnedToCaller = false;
          let asynchronous = false;
          const values = await new Promise<unknown[]>((resolve) => {
            const returned = call(Item, 'destroy', [(...args: unknown[]) => {
              notifications += 1;
              asynchronous = returnedToCaller;
              resolve(args);
            }]);
            assert.strictEqual(returned, undefined);
            returnedToCaller = true;
          });
          await new Promise<void>((resolve) => setImmediate(resolve));
          assert.strictEqual(asynchronous, true);
          assert.strictEqual(notifications, 1);
          assert.deepStrictEqual(values, [null, 1]);
          assert.deepStrictEqual(await native.find({}).toArray(), []);
          if (enabled) {
            assert.ok(typeof cache === 'object' && cache !== null);
            assert.strictEqual(call(cache, 'get', [survivor.id]), undefined);
          }
        } catch (error: unknown) {
          failed = true;
          failure = error;
        } finally {
          try {
            await control.destroy();
          } catch (error: unknown) {
            cleanupErrors.push(error);
          }
          try {
            ORM.configure({ model_cache: { enabled: false } });
          } catch (error: unknown) {
            cleanupErrors.push(error);
          }
        }
        if (cleanupErrors.length) throw new AggregateError(failed ? [failure, ...cleanupErrors] : cleanupErrors, 'Static destroy selection operation/cleanup failed');
        if (failed) throw failure;
      });

      it(`static destroy rejects selector and acquisition errors without deleting rows (${cell})`, async () => {
        const Item = modelType('static_errors');
        const control = connection(Item);
        let failed = false;
        let failure: unknown;
        const cleanupErrors: unknown[] = [];
        try {
          const survivor = new Item({ name: 'survivor', ...(manual ? { id: 0 } : {}) });
          await save(survivor);
          const native = server.client.db('production_port').collection(`${table}_static_errors`);
          const before = await native.find({}).toArray();
          assert.strictEqual(before.length, 1);
          const badId = manual ? false : 'invalid-default-id';
          for (const query of [{ id: badId }, { $ids: [badId] }, { name: { $unsupported: 'survivor' } }]) {
            let notifications = 0;
            let returnedToCaller = false;
            let asynchronous = false;
            const values = await new Promise<unknown[]>((resolve) => {
              const returned = call(Item, 'destroy', [query, (...args: unknown[]) => {
                notifications += 1;
                asynchronous = returnedToCaller;
                resolve(args);
              }]);
              assert.strictEqual(returned, undefined);
              returnedToCaller = true;
            });
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.strictEqual(asynchronous, true);
            assert.strictEqual(notifications, 1);
            assert.strictEqual(values.length, 1);
            assert.ok(values[0] instanceof Error);
            assert.deepStrictEqual(await native.find({}).toArray(), before);
            if (enabled) {
              const cache: unknown = Reflect.get(Item, 'cache');
              assert.ok(typeof cache === 'object' && cache !== null);
              assert.strictEqual(call(cache, 'get', [survivor.id]), survivor);
            }
          }
          await control.destroy();
          let notifications = 0;
          let returnedToCaller = false;
          let asynchronous = false;
          const values = await new Promise<unknown[]>((resolve) => {
            const returned = call(Item, 'destroy', [{ id: badId }, (...args: unknown[]) => {
              notifications += 1;
              asynchronous = returnedToCaller;
              resolve(args);
            }]);
            assert.strictEqual(returned, undefined);
            returnedToCaller = true;
          });
          await new Promise<void>((resolve) => setImmediate(resolve));
          assert.strictEqual(asynchronous, true);
          assert.strictEqual(notifications, 1);
          assert.strictEqual(values.length, 1);
          assert.ok(values[0] instanceof Error);
          assert.match(values[0].message, /Mongo connection is closed/);
          assert.doesNotMatch(values[0].message, /Invalid default Mongo id|Manual Mongo id/);
          assert.deepStrictEqual(await native.find({}).toArray(), before);
        } catch (error: unknown) {
          failed = true;
          failure = error;
        } finally {
          try {
            await control.destroy();
          } catch (error: unknown) {
            cleanupErrors.push(error);
          }
          try {
            ORM.configure({ model_cache: { enabled: false } });
          } catch (error: unknown) {
            cleanupErrors.push(error);
          }
        }
        if (cleanupErrors.length) throw new AggregateError(failed ? [failure, ...cleanupErrors] : cleanupErrors, 'Static destroy errors operation/cleanup failed');
        if (failed) throw failure;
      });

      it(`evicts the deleted model without changing an independent survivor (${cell})`, async () => {
        const Item = modelType('delete');
        const control = connection(Item);
        try {
          const removed = new Item({ name: 'removed', ...(manual ? { id: 0 } : {}) });
          const survivor = new Item({ name: 'survivor', ...(manual ? { id: 1 } : {}) });
          await save(removed);
          await save(survivor);
          const before = await findModels(Item, { id: survivor.id });
          assert.strictEqual(before.length, 1);
          let notifications = 0;
          await new Promise<void>((resolve, reject) => {
            const returned: unknown = removed.destroy({
              success() {
                notifications += 1;
                resolve();
              },
              error(_model: unknown, error: unknown) {
                notifications += 1;
                reject(error);
              },
            });
            assert.strictEqual(returned, undefined);
          });
          assert.strictEqual(notifications, 1);
          await assert.rejects(fetch(new Item({ id: removed.id })), /Model not found/);
          assert.deepStrictEqual(await materialize(publicCursor(Item, { id: removed.id })), []);
          assert.deepStrictEqual(await findModels(Item, { id: removed.id }), []);
          const after = await findModels(Item, { id: survivor.id });
          assert.strictEqual(after.length, 1);
          assert.deepStrictEqual(after[0].toJSON(), { id: survivor.id, name: 'survivor', _rev: 1 });
          if (enabled) {
            assert.strictEqual(before[0], survivor);
            assert.strictEqual(after[0], survivor, 'Deleting another model must retain cached survivor identity');
          } else assert.notStrictEqual(after[0], before[0]);
          const native = await collection(control);
          assert.strictEqual(await native.countDocuments(), 1);
          assert.strictEqual((await native.findOne(manual ? { id: 1 } : { _id: new ObjectId(String(survivor.id)) }))?.name, 'survivor');
        } finally {
          ORM.configure({ model_cache: { enabled: false } });
          await control.destroy();
          assert.strictEqual(ORM.ConnectionPool.get(control.url), undefined);
        }
      });
    }
  }

  for (const guard of ['closed', 'sync', 'schema', 'graph']) {
    it(`database tools guard ${guard} failures before clearing rows or creating indexes`, async () => {
      ORM.configure({ model_cache: { enabled: false } });
      const table = `database_guard_${guard}`;
      class Guarded extends Backbone.Model {
        urlRoot = `${server.uri}/${table}`;
        schema() {
          return guard === 'graph' ? { parent: ['belongsTo', Guarded] } : { name: ['String', { indexed: true }] };
        }
      }
      let registrationFailure: unknown;
      try {
        Guarded.prototype.sync = Mongo.sync(Guarded);
      } catch (error: unknown) {
        registrationFailure = error;
      }
      if (guard === 'graph') assert.ok(registrationFailure instanceof Error);
      else assert.strictEqual(registrationFailure, undefined);
      const control = connection(Guarded);
      const controls = [control];
      const priorSync = Guarded.prototype.sync;
      const priorSchema: unknown = Reflect.get(Guarded, 'schema');
      let failed = false;
      let failure: unknown;
      const cleanupErrors: unknown[] = [];
      try {
        const native = server.client.db('production_port').collection(table);
        await native.insertOne({ name: 'survivor', _rev: 6 });
        await native.createIndex({ sentinel: -1 }, { name: 'retained_custom' });
        const rows = await native.find({}).toArray();
        const indexes = await native.listIndexes().toArray();
        const db = call(Guarded, 'db');
        assert.ok(typeof db === 'object' && db !== null);
        if (guard === 'closed') await control.destroy();
        else if (guard === 'sync' || guard === 'schema') {
          class Replacement extends Backbone.Model {
            urlRoot = `${server.uri}/${table}_replacement`;
          }
          Replacement.prototype.sync = Mongo.sync(Replacement);
          controls.push(connection(Replacement));
          if (guard === 'sync') Guarded.prototype.sync = Replacement.prototype.sync;
          else Reflect.set(Guarded, 'schema', () => call(Replacement, 'schema'));
        }
        for (const operation of [
          { method: 'dropTable', args: [] },
          { method: 'ensureIndex', args: ['should_not_exist'] },
          { method: 'createOrUpdateTable', args: [{}] },
        ]) {
          let notifications = 0;
          let returnedToCaller = false;
          let asynchronous = false;
          const values = await new Promise<unknown[]>((resolve) => {
            const returned = call(db, operation.method, [...operation.args, (...args: unknown[]) => {
              notifications++;
              asynchronous = returnedToCaller;
              resolve(args);
            }]);
            assert.strictEqual(returned, undefined);
            returnedToCaller = true;
          });
          await new Promise<void>((resolve) => setImmediate(resolve));
          assert.strictEqual(notifications, 1);
          assert.strictEqual(asynchronous, true);
          assert.strictEqual(values.length, 1);
          assert.ok(values[0] instanceof Error);
          if (guard === 'graph') assert.strictEqual(values[0], registrationFailure);
          else assert.match(values[0].message, guard === 'closed' ? /connection is closed/ : guard === 'sync' ? /sync owner was replaced/ : /schema owner was replaced/);
          assert.deepStrictEqual(await native.find({}).toArray(), rows);
          assert.deepStrictEqual(await native.listIndexes().toArray(), indexes);
        }
        const namespaces = await server.client.db('production_port').listCollections({ name: table }).toArray();
        const outerOperations = [{ host: db, method: 'ensureSchema' }, { host: db, method: 'resetSchema' }];
        // Static reset dispatches through the replacement sync, not this captured db owner.
        if (guard !== 'sync') outerOperations.push({ host: Guarded, method: 'resetSchema' });
        for (const operation of outerOperations) {
          let notifications = 0;
          let returnedToCaller = false;
          let asynchronous = false;
          const values = await new Promise<unknown[]>((resolve) => {
            const returned = call(operation.host, operation.method, [{}, (...args: unknown[]) => {
              notifications++;
              asynchronous = returnedToCaller;
              resolve(args);
            }]);
            assert.strictEqual(returned, undefined);
            returnedToCaller = true;
          });
          await new Promise<void>((resolve) => setImmediate(resolve));
          assert.strictEqual(notifications, 1);
          assert.strictEqual(asynchronous, true);
          assert.strictEqual(values.length, 1);
          assert.ok(values[0] instanceof Error);
          if (guard === 'graph') assert.strictEqual(values[0], registrationFailure);
          else assert.match(values[0].message, guard === 'closed' ? /connection is closed/ : guard === 'sync' ? /sync owner was replaced/ : /schema owner was replaced/);
          assert.deepStrictEqual(await native.find({}).toArray(), rows);
          assert.deepStrictEqual(await native.listIndexes().toArray(), indexes);
          assert.deepStrictEqual(await server.client.db('production_port').listCollections({ name: table }).toArray(), namespaces);
        }
      } catch (error: unknown) {
        failed = true;
        failure = error;
      } finally {
        Guarded.prototype.sync = priorSync;
        Reflect.set(Guarded, 'schema', priorSchema);
        const closed = await Promise.allSettled(controls.map((owned) => owned.destroy()));
        cleanupErrors.push(...closed.filter((entry) => entry.status === 'rejected').map((entry) => entry.reason));
        ORM.configure({ model_cache: { enabled: false } });
        if (failed || cleanupErrors.length) throw new AggregateError([...(failed ? [failure] : []), ...cleanupErrors], 'Database guard operation/cleanup failed');
      }
    });
  }

  for (const enabled of [false, true]) {
    it(`database tools execute each shared-client FIFO job and callback reentry (cache=${enabled})`, async () => {
      ORM.configure({ model_cache: { enabled, max: 100 } });
      const table = `schema_fifo_${enabled ? 'on' : 'off'}`;
      const peerTable = `${table}_peer`;
      class Item extends Backbone.Model {
        urlRoot = `${server.uri}/${table}`;
        schema() {
          return { id: ['Integer', { indexed: true }], name: ['String', { indexed: true }] };
        }
      }
      class Peer extends Backbone.Model {
        urlRoot = `${server.uri}/${peerTable}`;
        schema() {
          return { id: ['Integer', { indexed: true }], name: ['String', { indexed: true }] };
        }
      }
      Item.prototype.sync = Mongo.sync(Item, { monitorCommands: true });
      Peer.prototype.sync = Mongo.sync(Peer, { monitorCommands: true });
      const controls = [connection(Item), connection(Peer)];
      const active = new Set<number>();
      const commands: Array<{ table: string; kind: string; fields: string[]; activeBefore: number }> = [];
      const started = (event: CommandStartedEvent): void => {
        const target: unknown = event.command.delete ?? event.command.createIndexes;
        if (target !== table && target !== peerTable) return;
        const indexKey = event.command.indexes?.[0]?.key;
        const fields = indexKey instanceof Map ? Array.from(indexKey.keys()) : Object.keys(indexKey ?? {});
        commands.push({ table: target, kind: event.commandName === 'delete' ? 'delete' : 'index', fields, activeBefore: active.size });
        active.add(event.requestId);
      };
      const settled = (event: CommandSucceededEvent | CommandFailedEvent): void => {
        active.delete(event.requestId);
      };
      let client: MongoClient | undefined;
      let failed = false;
      let failure: unknown;
      const cleanupErrors: unknown[] = [];
      try {
        await collection(controls[0]);
        await collection(controls[1]);
        const pooled: unknown = ORM.ConnectionPool.get(controls[0].url);
        assert.ok(pooled instanceof MongoClient);
        assert.strictEqual(controls[0].url, controls[1].url);
        assert.strictEqual(ORM.ConnectionPool.get(controls[1].url), pooled);
        client = pooled;
        const item = new Item({ name: 'cleared target' });
        const peer = new Peer({ name: 'retained peer' });
        await save(item);
        await save(peer);
        const database = server.client.db('production_port');
        const native = database.collection(table);
        const peerNative = database.collection(peerTable);
        const peerRows = await peerNative.find({}).toArray();
        const namespaces = await database.listCollections({ name: table }).toArray();
        const peerNamespaces = await database.listCollections({ name: peerTable }).toArray();
        const db = call(Item, 'db');
        const peerDb = call(Peer, 'db');
        assert.ok(typeof db === 'object' && db !== null);
        assert.ok(typeof peerDb === 'object' && peerDb !== null);
        client.on('commandStarted', started);
        client.on('commandSucceeded', settled);
        client.on('commandFailed', settled);
        const plan: Array<{ host: object; table: string; method: 'ensureSchema' | 'resetSchema' }> = [
          { host: db, table, method: 'ensureSchema' },
          { host: db, table, method: 'ensureSchema' },
          { host: peerDb, table: peerTable, method: 'ensureSchema' },
          { host: db, table, method: 'resetSchema' },
          { host: db, table, method: 'resetSchema' },
          { host: db, table, method: 'ensureSchema' },
        ];
        const completionOrder: number[] = [];
        const outcomes = await Promise.all(plan.map((job, index) => schemaOutcome(job.host, job.method, index % 2 ? { verbose: false } : undefined).then((values) => {
          completionOrder.push(index);
          return values;
        })));
        assert.deepStrictEqual(outcomes, plan.map(() => [null]));
        assert.deepStrictEqual(completionOrder, plan.map((_job, index) => index));
        let offset = 0;
        for (const job of plan) {
          assert.strictEqual(commands[offset]?.activeBefore, 0, 'The next outer job waits for previously started native requests');
          if (job.method === 'resetSchema') {
            assert.deepStrictEqual(commands[offset], { table: job.table, kind: 'delete', fields: [], activeBefore: 0 });
            offset++;
          }
          const indexes = commands.slice(offset, offset + 3);
          assert.deepStrictEqual(indexes.map(({ table, kind }) => ({ table, kind })), Array.from({ length: 3 }, () => ({ table: job.table, kind: 'index' })));
          assert.deepStrictEqual(indexes.flatMap(({ fields }) => fields).sort(), ['_id', 'id', 'name']);
          offset += 3;
        }
        assert.strictEqual(commands.length, offset, 'Every invocation issues its own native requests, including both destructive resets');
        assert.strictEqual(active.size, 0);
        assert.deepStrictEqual(await native.find({}).toArray(), []);
        assert.deepStrictEqual(await peerNative.find({}).toArray(), peerRows);
        assert.deepStrictEqual(await database.listCollections({ name: table }).toArray(), namespaces);
        assert.deepStrictEqual(await database.listCollections({ name: peerTable }).toArray(), peerNamespaces);
        const indexes = await native.listIndexes().toArray();
        assert.deepStrictEqual(indexes.find((entry) => entry.name === 'id_1')?.key, { id: 1 });
        assert.deepStrictEqual(indexes.find((entry) => entry.name === 'name_1')?.key, { name: 1 });
        if (enabled) {
          const cache: unknown = Reflect.get(Item, 'cache');
          const peerCache: unknown = Reflect.get(Peer, 'cache');
          assert.ok(typeof cache === 'object' && cache !== null);
          assert.ok(typeof peerCache === 'object' && peerCache !== null);
          assert.strictEqual(call(cache, 'get', [item.id]), item);
          assert.strictEqual(call(peerCache, 'get', [peer.id]), peer);
        }
        let firstCalls = 0;
        let nestedCalls = 0;
        let firstReturnedToCaller = false;
        let firstAsynchronous = false;
        let nestedReturnedToCaller = false;
        let nestedAsynchronous = false;
        let firstValues: unknown[] = [];
        let nestedValues: unknown[] = [];
        await new Promise<void>((resolve, reject) => {
          const returned = call(db, 'ensureSchema', [(...values: unknown[]) => {
            firstCalls++;
            firstAsynchronous = firstReturnedToCaller;
            firstValues = values;
            if (values[0]) return reject(values[0]);
            try {
              const nested = call(peerDb, 'resetSchema', [(...args: unknown[]) => {
                nestedCalls++;
                nestedAsynchronous = nestedReturnedToCaller;
                nestedValues = args;
                if (args[0]) reject(args[0]);
                else resolve();
              }]);
              assert.strictEqual(nested, undefined);
              nestedReturnedToCaller = true;
            } catch (error: unknown) {
              reject(error);
            }
          }]);
          assert.strictEqual(returned, undefined);
          firstReturnedToCaller = true;
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.strictEqual(firstCalls, 1);
        assert.strictEqual(nestedCalls, 1);
        assert.strictEqual(firstAsynchronous, true);
        assert.strictEqual(nestedAsynchronous, true);
        assert.deepStrictEqual(firstValues, [null]);
        assert.deepStrictEqual(nestedValues, [null]);
        assert.deepStrictEqual(await peerNative.find({}).toArray(), []);
        assert.strictEqual(active.size, 0);
      } catch (error: unknown) {
        failed = true;
        failure = error;
      } finally {
        client?.removeListener('commandStarted', started);
        client?.removeListener('commandSucceeded', settled);
        client?.removeListener('commandFailed', settled);
        const closed = await Promise.allSettled(controls.map(async (control) => control.destroy()));
        cleanupErrors.push(...closed.filter((entry) => entry.status === 'rejected').map((entry) => entry.reason));
        ORM.configure({ model_cache: { enabled: false } });
        if (failed || cleanupErrors.length) {
          console.error('Schema FIFO failures:', inspect({ operationFailed: failed, operationFailure: failure, cleanupErrors }, { depth: null, maxArrayLength: null, maxStringLength: null, colors: false }));
          throw new AggregateError([...(failed ? [failure] : []), ...cleanupErrors], 'Schema FIFO operation/cleanup failed');
        }
      }
    });

    it(`database tools isolate FIFO index errors and allow subsequent owned jobs (cache=${enabled})`, async () => {
      ORM.configure({ model_cache: { enabled, max: 100 } });
      const table = `schema_fifo_error_${enabled ? 'on' : 'off'}`;
      const peerTable = `${table}_peer`;
      class Conflict extends Backbone.Model {
        urlRoot = `${server.uri}/${table}`;
        schema() {
          return { id: ['Integer', { indexed: true }], name: ['String', { indexed: true }] };
        }
      }
      class Peer extends Backbone.Model {
        urlRoot = `${server.uri}/${peerTable}`;
        schema() {
          return { id: ['Integer', { indexed: true }], name: ['String', { indexed: true }] };
        }
      }
      Conflict.prototype.sync = Mongo.sync(Conflict, { monitorCommands: true });
      Peer.prototype.sync = Mongo.sync(Peer, { monitorCommands: true });
      const controls = [connection(Conflict), connection(Peer)];
      const active = new Set<number>();
      const commands: Array<{ table: string; activeBefore: number }> = [];
      const codes: unknown[] = [];
      const started = (event: CommandStartedEvent): void => {
        const target: unknown = event.command.createIndexes;
        if (target !== table && target !== peerTable) return;
        commands.push({ table: target, activeBefore: active.size });
        active.add(event.requestId);
      };
      const succeeded = (event: CommandSucceededEvent): void => {
        active.delete(event.requestId);
      };
      const rejected = (event: CommandFailedEvent): void => {
        if (active.has(event.requestId)) codes.push(Reflect.get(event.failure, 'code'));
        active.delete(event.requestId);
      };
      let client: MongoClient | undefined;
      let failed = false;
      let failure: unknown;
      const cleanupErrors: unknown[] = [];
      try {
        const item = new Conflict({ name: 'retained conflict row' });
        const peer = new Peer({ name: 'retained peer' });
        await save(item);
        await save(peer);
        const pooled: unknown = ORM.ConnectionPool.get(controls[0].url);
        assert.ok(pooled instanceof MongoClient);
        assert.strictEqual(ORM.ConnectionPool.get(controls[1].url), pooled);
        client = pooled;
        const database = server.client.db('production_port');
        const native = database.collection(table);
        const peerNative = database.collection(peerTable);
        await native.createIndex({ name: 1 }, { unique: true });
        await native.createIndex({ sentinel: -1 }, { name: 'retained_custom' });
        const original = await native.createIndex({ name: 1 }, { background: true }).then(() => undefined, (error: unknown) => error);
        assert.ok(original instanceof Error);
        assert.strictEqual(Reflect.get(original, 'code'), 86);
        const rows = await native.find({}).toArray();
        const peerRows = await peerNative.find({}).toArray();
        const indexes = await native.listIndexes().toArray();
        const namespaces = await database.listCollections({ name: table }).toArray();
        const db = call(Conflict, 'db');
        const peerDb = call(Peer, 'db');
        assert.ok(typeof db === 'object' && db !== null);
        assert.ok(typeof peerDb === 'object' && peerDb !== null);
        client.on('commandStarted', started);
        client.on('commandSucceeded', succeeded);
        client.on('commandFailed', rejected);
        const outcomes = await Promise.all([schemaOutcome(db, 'ensureSchema'), schemaOutcome(db, 'ensureSchema', {}), schemaOutcome(peerDb, 'ensureSchema')]);
        for (const values of outcomes.slice(0, 2)) {
          assert.strictEqual(values.length, 1);
          assert.ok(values[0] instanceof Error);
          assert.strictEqual(values[0].message, 'Mongo ensureIndex failed');
          assert.strictEqual(Reflect.get(values[0], 'code'), 86);
          assert.strictEqual(Reflect.get(values[0], 'cause'), undefined);
        }
        assert.notStrictEqual(outcomes[0][0], outcomes[1][0], 'Each invocation runs its own failing native request');
        assert.deepStrictEqual(outcomes[2], [null]);
        assert.deepStrictEqual(commands.map(({ table }) => table), [table, table, table, table, table, table, peerTable, peerTable, peerTable]);
        for (const offset of [0, 3, 6]) assert.strictEqual(commands[offset]?.activeBefore, 0);
        assert.deepStrictEqual(codes, [86, 86]);
        assert.strictEqual(active.size, 0);
        const after = await native.listIndexes().toArray();
        for (const index of indexes) assert.deepStrictEqual(after.find((entry) => entry.name === index.name), index);
        assert.deepStrictEqual(after.find((entry) => entry.name === 'id_1')?.key, { id: 1 });
        assert.deepStrictEqual(await native.find({}).toArray(), rows);
        assert.deepStrictEqual(await peerNative.find({}).toArray(), peerRows);
        assert.deepStrictEqual(await database.listCollections({ name: table }).toArray(), namespaces);
        await native.dropIndex('name_1');
        assert.deepStrictEqual(await schemaOutcome(db, 'resetSchema'), [null]);
        assert.deepStrictEqual(await native.find({}).toArray(), []);
        assert.deepStrictEqual(await peerNative.find({}).toArray(), peerRows);
        assert.notStrictEqual((await native.listIndexes().toArray()).find((entry) => entry.name === 'name_1')?.unique, true);
        assert.deepStrictEqual(await database.listCollections({ name: table }).toArray(), namespaces);
        if (enabled) {
          const cache: unknown = Reflect.get(Conflict, 'cache');
          const peerCache: unknown = Reflect.get(Peer, 'cache');
          assert.ok(typeof cache === 'object' && cache !== null);
          assert.ok(typeof peerCache === 'object' && peerCache !== null);
          assert.strictEqual(call(cache, 'get', [item.id]), item);
          assert.strictEqual(call(peerCache, 'get', [peer.id]), peer);
        }
      } catch (error: unknown) {
        failed = true;
        failure = error;
      } finally {
        client?.removeListener('commandStarted', started);
        client?.removeListener('commandSucceeded', succeeded);
        client?.removeListener('commandFailed', rejected);
        const closed = await Promise.allSettled(controls.map(async (control) => control.destroy()));
        cleanupErrors.push(...closed.filter((entry) => entry.status === 'rejected').map((entry) => entry.reason));
        ORM.configure({ model_cache: { enabled: false } });
        if (failed || cleanupErrors.length) {
          console.error('Schema FIFO error failures:', inspect({ operationFailed: failed, operationFailure: failure, cleanupErrors }, { depth: null, maxArrayLength: null, maxStringLength: null, colors: false }));
          throw new AggregateError([...(failed ? [failure] : []), ...cleanupErrors], 'Schema FIFO error operation/cleanup failed');
        }
      }
    });
  }

  it('database tools allow independent owned clients to progress during another schema job', async () => {
    ORM.configure({ model_cache: { enabled: false } });
    const table = 'schema_independent_wide';
    const peerTable = 'schema_independent_peer';
    const peerUri = server.uri.replace('/production_port', '/schema_independent');
    class Wide extends Backbone.Model {
      urlRoot = `${server.uri}/${table}`;
      schema() {
        return { id: ['Integer', { indexed: true }], name: ['String', { indexed: true }] };
      }
    }
    class Peer extends Backbone.Model {
      urlRoot = `${peerUri}/${peerTable}`;
      schema() {
        return { name: ['String', { indexed: true }] };
      }
    }
    Wide.prototype.sync = Mongo.sync(Wide, { monitorCommands: true });
    Peer.prototype.sync = Mongo.sync(Peer, { monitorCommands: true });
    const controls = [connection(Wide), connection(Peer)];
    let wideClient: MongoClient | undefined;
    let peerClient: MongoClient | undefined;
    let releaseHold: (() => void) | undefined;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    let signalEntered: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const jobs: Array<Promise<{ failed: boolean; error?: unknown }>> = [];
    let firstEntered = false;
    let firstCompleted = false;
    let firstRejected = false;
    let firstError: unknown;
    let sameClientEntered = false;
    let wideCloses = 0;
    let peerCloses = 0;
    const wideClosed = (): void => {
      wideCloses++;
    };
    const peerClosed = (): void => {
      peerCloses++;
    };
    let failed = false;
    let failure: unknown;
    const cleanupErrors: unknown[] = [];
    try {
      await collection(controls[0]);
      await collection(controls[1]);
      const widePooled: unknown = ORM.ConnectionPool.get(controls[0].url);
      const peerPooled: unknown = ORM.ConnectionPool.get(controls[1].url);
      assert.ok(widePooled instanceof MongoClient);
      assert.ok(peerPooled instanceof MongoClient);
      assert.notStrictEqual(widePooled, peerPooled);
      assert.notStrictEqual(controls[0].url, controls[1].url);
      wideClient = widePooled;
      peerClient = peerPooled;
      wideClient.on('topologyClosed', wideClosed);
      peerClient.on('topologyClosed', peerClosed);
      const native = server.client.db('production_port').collection(table);
      const peerNative = server.client.db('schema_independent').collection(peerTable);
      await native.insertOne({ name: 'preserved wide row', _rev: 4 });
      await peerNative.insertOne({ name: 'cleared independent row', _rev: 7 });
      const rows = await native.find({}).toArray();
      const wideNamespaces = await server.client.db('production_port').listCollections({ name: table }).toArray();
      const namespaces = await server.client.db('schema_independent').listCollections({ name: peerTable }).toArray();
      const db = call(Wide, 'db');
      const configuredPeer = call(Peer, 'db');
      assert.ok(typeof db === 'object' && db !== null);
      assert.ok(typeof configuredPeer === 'object' && configuredPeer !== null);
      const firstRequest = call(controls[0], 'scheduleSchemaOperation', [async () => {
        await result((callback) => call(db, 'createOrUpdateTable', [{}, callback]));
        firstEntered = true;
        assert.ok(signalEntered);
        signalEntered();
        await hold;
      }, () => call(controls[0], 'assertAvailable')]);
      assert.ok(firstRequest instanceof Promise);
      const firstJob: Promise<{ failed: boolean; error?: unknown }> = firstRequest.then(() => {
        firstCompleted = true;
        return { failed: false };
      }, (error: unknown) => {
        firstRejected = true;
        firstError = error;
        signalEntered?.();
        return { failed: true, error };
      });
      jobs.push(firstJob);
      await entered;
      if (firstRejected) throw firstError;
      assert.strictEqual(firstEntered, true);
      assert.strictEqual(firstCompleted, false);
      const sameRequest = call(controls[0], 'scheduleSchemaOperation', [async () => {
        sameClientEntered = true;
        await result((callback) => call(db, 'createOrUpdateTable', [{}, callback]));
      }, () => call(controls[0], 'assertAvailable')]);
      assert.ok(sameRequest instanceof Promise);
      const sameJob: Promise<{ failed: boolean; error?: unknown }> = sameRequest.then(() => ({ failed: false }), (error: unknown) => ({ failed: true, error }));
      jobs.push(sameJob);
      const peerJob: Promise<{ failed: boolean; values?: unknown[]; error?: unknown }> = schemaOutcome(configuredPeer, 'resetSchema').then((values) => ({ failed: false, values }), (error: unknown) => ({ failed: true, error }));
      jobs.push(peerJob);
      const peerOutcome = await peerJob;
      if (peerOutcome.failed) throw peerOutcome.error;
      assert.deepStrictEqual(peerOutcome.values, [null]);
      assert.strictEqual(firstCompleted, false);
      assert.strictEqual(firstRejected, false);
      assert.strictEqual(sameClientEntered, false);
      assert.strictEqual(ORM.ConnectionPool.get(controls[0].url), wideClient);
      assert.strictEqual(ORM.ConnectionPool.get(controls[1].url), peerClient);
      assert.strictEqual(wideCloses, 0);
      assert.strictEqual(peerCloses, 0);
      assert.deepStrictEqual(await native.find({}).toArray(), rows);
      assert.deepStrictEqual(await peerNative.find({}).toArray(), []);
      assert.deepStrictEqual(await server.client.db('production_port').listCollections({ name: table }).toArray(), wideNamespaces);
      assert.deepStrictEqual(await server.client.db('schema_independent').listCollections({ name: peerTable }).toArray(), namespaces);
      assert.deepStrictEqual(Object.fromEntries((await native.listIndexes().toArray()).map((entry) => [entry.name, entry.key])), { _id_: { _id: 1 }, id_1: { id: 1 }, name_1: { name: 1 } });
      assert.deepStrictEqual(Object.fromEntries((await peerNative.listIndexes().toArray()).map((entry) => [entry.name, entry.key])), { _id_: { _id: 1 }, name_1: { name: 1 } });
      assert.ok(releaseHold);
      releaseHold();
      for (const outcome of await Promise.all([firstJob, sameJob])) {
        if (outcome.failed) throw outcome.error;
      }
      assert.strictEqual(firstCompleted, true);
      assert.strictEqual(sameClientEntered, true);
      assert.deepStrictEqual(await native.find({}).toArray(), rows);
      assert.deepStrictEqual(await peerNative.find({}).toArray(), []);
      assert.deepStrictEqual(await server.client.db('production_port').listCollections({ name: table }).toArray(), wideNamespaces);
      assert.deepStrictEqual(await server.client.db('schema_independent').listCollections({ name: peerTable }).toArray(), namespaces);
    } catch (error: unknown) {
      failed = true;
      failure = error;
    } finally {
      releaseHold?.();
      for (const outcome of await Promise.all(jobs)) {
        if (outcome.failed && (!failed || outcome.error !== failure)) cleanupErrors.push(outcome.error);
      }
      const closed = await Promise.allSettled(controls.map(async (control) => control.destroy()));
      cleanupErrors.push(...closed.filter((entry) => entry.status === 'rejected').map((entry) => entry.reason));
      try {
        assert.strictEqual(ORM.ConnectionPool.get(controls[0].url), undefined);
        assert.strictEqual(ORM.ConnectionPool.get(controls[1].url), undefined);
        if (wideClient) assert.strictEqual(wideCloses, 1);
        if (peerClient) assert.strictEqual(peerCloses, 1);
      } catch (error: unknown) {
        cleanupErrors.push(error);
      }
      wideClient?.removeListener('topologyClosed', wideClosed);
      peerClient?.removeListener('topologyClosed', peerClosed);
      if (failed || cleanupErrors.length) {
        console.error('Independent schema failures:', inspect({ operationFailed: failed, operationFailure: failure, cleanupErrors }, { depth: null, maxArrayLength: null, maxStringLength: null, colors: false }));
        throw new AggregateError([...(failed ? [failure] : []), ...cleanupErrors], 'Independent schema operation/cleanup failed');
      }
    }
  });

  for (const change of ['lease', 'dispose', 'pool', 'sync', 'schema']) {
    it(`database tools settle active and queued schema jobs after ${change} ownership changes`, async () => {
      ORM.configure({ model_cache: { enabled: false } });
      const table = `schema_ownership_${change}`;
      const peerTable = `${table}_peer`;
      class Item extends Backbone.Model {
        urlRoot = `${server.uri}/${table}`;
        schema() {
          return { name: ['String', { indexed: true }] };
        }
      }
      class Peer extends Backbone.Model {
        urlRoot = `${server.uri}/${peerTable}`;
        schema() {
          return { name: ['String', { indexed: true }] };
        }
      }
      Item.prototype.sync = Mongo.sync(Item, { monitorCommands: true });
      Peer.prototype.sync = Mongo.sync(Peer, { monitorCommands: true });
      const controls = [connection(Item), connection(Peer)];
      const priorSync = Item.prototype.sync;
      const priorSchema: unknown = Reflect.get(Item, 'schema');
      const replacement = change === 'pool' ? new MongoClient(server.uri, { monitorCommands: true }) : undefined;
      let client: MongoClient | undefined;
      let changed = false;
      let closes = 0;
      let cleanup: Promise<unknown> | undefined;
      const commands: Array<{ table: string; kind: string }> = [];
      const closed = (): void => {
        closes++;
      };
      const started = (event: CommandStartedEvent): void => {
        const target: unknown = event.command.delete ?? event.command.createIndexes;
        if (target !== table && target !== peerTable) return;
        commands.push({ table: target, kind: event.commandName });
        if (changed || event.command.delete !== table) return;
        changed = true;
        if (change === 'lease') cleanup = controls[0].destroy().then(() => null, (error: unknown) => error);
        else if (change === 'dispose') cleanup = ORM.ConnectionPool.dispose(controls[0].url).then(() => null, (error: unknown) => error);
        else if (change === 'pool') {
          assert.ok(replacement);
          ORM.ConnectionPool.set(controls[0].url, replacement);
        } else if (change === 'sync') Item.prototype.sync = Backbone.sync;
        else Reflect.set(Item, 'schema', () => call(Peer, 'schema'));
      };
      let failed = false;
      let failure: unknown;
      const cleanupErrors: unknown[] = [];
      try {
        const item = new Item({ name: 'cleared before ownership changed' });
        const peer = new Peer({ name: 'retained peer' });
        await save(item);
        await save(peer);
        const pooled: unknown = ORM.ConnectionPool.get(controls[0].url);
        assert.ok(pooled instanceof MongoClient);
        assert.strictEqual(ORM.ConnectionPool.get(controls[1].url), pooled);
        client = pooled;
        const database = server.client.db('production_port');
        const native = database.collection(table);
        const peerNative = database.collection(peerTable);
        const indexes = await native.listIndexes().toArray();
        const namespaces = await database.listCollections({ name: table }).toArray();
        const peerRows = await peerNative.find({}).toArray();
        const db = call(Item, 'db');
        const peerDb = call(Peer, 'db');
        assert.ok(typeof db === 'object' && db !== null);
        assert.ok(typeof peerDb === 'object' && peerDb !== null);
        client.on('topologyClosed', closed);
        client.on('commandStarted', started);
        const outcomes = await Promise.all([schemaOutcome(db, 'resetSchema'), schemaOutcome(db, 'ensureSchema'), schemaOutcome(peerDb, 'ensureSchema')]);
        assert.strictEqual(changed, true);
        const pattern = change === 'lease' ? /connection is closed/ : change === 'dispose' ? /client is closed|connection is closed/ : change === 'pool' ? /pooled client was replaced/ : change === 'sync' ? /sync owner was replaced/ : /schema owner was replaced/;
        for (const values of outcomes.slice(0, 2)) {
          assert.strictEqual(values.length, 1);
          assert.ok(values[0] instanceof Error);
          assert.match(values[0].message, pattern);
        }
        if (change === 'dispose' || change === 'pool') {
          assert.strictEqual(outcomes[2].length, 1);
          assert.ok(outcomes[2][0] instanceof Error);
          assert.match(outcomes[2][0].message, pattern);
          assert.deepStrictEqual(commands, [{ table, kind: 'delete' }]);
        } else {
          assert.deepStrictEqual(outcomes[2], [null]);
          assert.deepStrictEqual(commands, [{ table, kind: 'delete' }, { table: peerTable, kind: 'createIndexes' }, { table: peerTable, kind: 'createIndexes' }]);
        }
        if (cleanup) assert.strictEqual(await cleanup, null);
        assert.strictEqual(closes, change === 'dispose' ? 1 : 0);
        assert.deepStrictEqual(await native.find({}).toArray(), []);
        assert.deepStrictEqual(await native.listIndexes().toArray(), indexes);
        assert.deepStrictEqual(await database.listCollections({ name: table }).toArray(), namespaces);
        assert.deepStrictEqual(await peerNative.find({}).toArray(), peerRows);
        Item.prototype.sync = priorSync;
        Reflect.set(Item, 'schema', priorSchema);
        if (change === 'sync' || change === 'schema') assert.deepStrictEqual(await schemaOutcome(db, 'ensureSchema'), [null]);
      } catch (error: unknown) {
        failed = true;
        failure = error;
      } finally {
        client?.removeListener('commandStarted', started);
        Item.prototype.sync = priorSync;
        Reflect.set(Item, 'schema', priorSchema);
        if (cleanup) {
          const error = await cleanup;
          if (error) cleanupErrors.push(error);
        }
        const released = await Promise.allSettled(controls.map(async (control) => control.destroy()));
        cleanupErrors.push(...released.filter((entry) => entry.status === 'rejected').map((entry) => entry.reason));
        client?.removeListener('topologyClosed', closed);
        if (replacement) {
          if (ORM.ConnectionPool.get(controls[0].url) === replacement) ORM.ConnectionPool.del(controls[0].url);
          try {
            await replacement.close();
          } catch (error: unknown) {
            cleanupErrors.push(error);
          }
        }
        if (failed || cleanupErrors.length) {
          console.error('Schema ownership failures:', inspect({ change, operationFailed: failed, operationFailure: failure, cleanupErrors }, { depth: null, maxArrayLength: null, maxStringLength: null, colors: false }));
          throw new AggregateError([...(failed ? [failure] : []), ...cleanupErrors], 'Schema ownership operation/cleanup failed');
        }
      }
    });
  }

  it('database tools reject malformed outer options before native mutations', async () => {
    ORM.configure({ model_cache: { enabled: false } });
    class Guarded extends Backbone.Model {
      urlRoot = `${server.uri}/schema_options_guard`;
      schema() {
        return { name: ['String', { indexed: true }] };
      }
    }
    Guarded.prototype.sync = Mongo.sync(Guarded);
    const control = connection(Guarded);
    try {
      const native = server.client.db('production_port').collection('schema_options_guard');
      await native.insertOne({ name: 'retained options row', _rev: 6 });
      const rows = await native.find({}).toArray();
      const indexes = await native.listIndexes().toArray();
      const namespaces = await server.client.db('production_port').listCollections({ name: 'schema_options_guard' }).toArray();
      const db = call(Guarded, 'db');
      assert.ok(typeof db === 'object' && db !== null);
      for (const method of ['ensureSchema', 'resetSchema'] as const) {
        assert.throws(() => call(db, method), /requires a callback/);
        for (const options of [null, [], { verbose: 'invalid' }]) {
          const values = await schemaOutcome(db, method, options);
          assert.strictEqual(values.length, 1);
          assert.ok(values[0] instanceof Error);
          assert.match(values[0].message, options === null || Array.isArray(options) ? /options must be an object/ : /verbose must be a boolean/);
          assert.deepStrictEqual(await native.find({}).toArray(), rows);
          assert.deepStrictEqual(await native.listIndexes().toArray(), indexes);
          assert.deepStrictEqual(await server.client.db('production_port').listCollections({ name: 'schema_options_guard' }).toArray(), namespaces);
        }
      }
      assert.strictEqual(ORM.ConnectionPool.get(control.url), undefined);
    } finally {
      await control.destroy();
    }
  });

  it('database tools settle queued native handshake failures without outer-job disposal deadlock', async () => {
    ORM.configure({ model_cache: { enabled: false } });
    class Unreachable extends Backbone.Model {
      urlRoot = 'mongodb://127.0.0.1:1/failure/schema_jobs';
    }
    Unreachable.prototype.sync = Mongo.sync(Unreachable, { serverSelectionTimeoutMS: 80 });
    const control = connection(Unreachable);
    let failed = false;
    let failure: unknown;
    const cleanupErrors: unknown[] = [];
    try {
      const db = call(Unreachable, 'db');
      assert.ok(typeof db === 'object' && db !== null);
      const outcomes = await Promise.all([schemaOutcome(db, 'ensureSchema'), schemaOutcome(db, 'resetSchema'), schemaOutcome(db, 'ensureSchema')]);
      for (const values of outcomes) {
        assert.strictEqual(values.length, 1);
        assert.ok(values[0] instanceof Error);
      }
      assert.strictEqual((outcomes[0][0] as Error).message, 'Mongo connection failed');
      for (const values of outcomes.slice(1)) assert.match((values[0] as Error).message, /client is closed/);
      assert.strictEqual(ORM.ConnectionPool.get(control.url), undefined);
    } catch (error: unknown) {
      failed = true;
      failure = error;
    } finally {
      try {
        await control.destroy();
      } catch (error: unknown) {
        cleanupErrors.push(error);
      }
      if (failed || cleanupErrors.length) {
        console.error('Schema handshake failures:', inspect({ operationFailed: failed, operationFailure: failure, cleanupErrors }, { depth: null, maxArrayLength: null, maxStringLength: null, colors: false }));
        throw new AggregateError([...(failed ? [failure] : []), ...cleanupErrors], 'Schema handshake operation/cleanup failed');
      }
    }
  });

  it('static destroy preserves the original failed-registration error without deleting rows', async () => {
    ORM.configure({ model_cache: { enabled: false } });
    class Invalid extends Backbone.Model {
      urlRoot = `${server.uri}/static_failed_registration`;
      schema() {
        return { parent: ['belongsTo', Invalid] };
      }
    }
    let original: unknown;
    try {
      Invalid.prototype.sync = Mongo.sync(Invalid);
    } catch (error: unknown) {
      original = error;
    }
    assert.ok(original instanceof Error);
    const control = connection(Invalid);
    let failed = false;
    let failure: unknown;
    const cleanupErrors: unknown[] = [];
    try {
      const native = server.client.db('production_port').collection('static_failed_registration');
      await native.insertOne({ name: 'survivor', _rev: 1 });
      const before = await native.find({}).toArray();
      let notifications = 0;
      let returnedToCaller = false;
      let asynchronous = false;
      const values = await new Promise<unknown[]>((resolve) => {
        const returned = call(Invalid, 'destroy', [(...args: unknown[]) => {
          notifications += 1;
          asynchronous = returnedToCaller;
          resolve(args);
        }]);
        assert.strictEqual(returned, undefined);
        returnedToCaller = true;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.strictEqual(asynchronous, true);
      assert.strictEqual(notifications, 1);
      assert.strictEqual(values.length, 1);
      assert.strictEqual(values[0], original);
      assert.deepStrictEqual(await native.find({}).toArray(), before);
    } catch (error: unknown) {
      failed = true;
      failure = error;
    } finally {
      try {
        await control.destroy();
      } catch (error: unknown) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length) throw new AggregateError(failed ? [failure, ...cleanupErrors] : cleanupErrors, 'Static destroy registration operation/cleanup failed');
    if (failed) throw failure;
  });

  it('shares owned clients across models and closes only the final lease once', async () => {
    class First extends Backbone.Model {
      urlRoot = `${server.uri}/shared_first`;
    }
    class Second extends Backbone.Model {
      urlRoot = `${server.uri}/shared_second`;
    }
    First.prototype.sync = Mongo.sync(First);
    Second.prototype.sync = Mongo.sync(Second);
    const first = connection(First);
    const second = connection(Second);
    assert.strictEqual(first.url, second.url);
    assert.match(first.url, /^backbone-mongo:[0-9a-f]{64}$/);
    await collection(first);
    await collection(second);
    const client: unknown = ORM.ConnectionPool.get(first.url);
    assert.ok(client instanceof MongoClient);
    let closed = 0;
    client.on('topologyClosed', () => {
      closed += 1;
    });
    await first.destroy();
    assert.strictEqual(ORM.ConnectionPool.get(second.url), client);
    assert.strictEqual(closed, 0);
    assert.strictEqual((await collection(second)).collectionName, 'shared_second');
    await second.destroy();
    await second.destroy();
    assert.strictEqual(closed, 1);
    assert.strictEqual(ORM.ConnectionPool.get(second.url), undefined);
  });

  it('retains unsets after native write failure and emits success/error only once per save', async () => {
    class Rejected extends Backbone.Model {
      urlRoot = `${server.uri}/rejected`;
    }
    Rejected.prototype.sync = Mongo.sync(Rejected);
    const control = connection(Rejected);
    const item = new Rejected({ name: 'kept', remove: 'later' });
    let successes = 0;
    let errors = 0;
    item.on('sync', () => {
      successes += 1;
    });
    item.on('error', () => {
      errors += 1;
    });
    try {
      await save(item);
      await server.client.db().command({ collMod: 'rejected', validator: { _rev: { $lte: 1 } }, validationLevel: 'strict' });
      item.unset('remove');
      await assert.rejects(save(item), (error: unknown) => error instanceof Error && Reflect.get(error, 'code') === 121);
      assert.strictEqual(item.get('_rev'), 1);
      assert.strictEqual(
        (
          await server.client
            .db()
            .collection('rejected')
            .findOne({ _id: new ObjectId(String(item.id)) })
        )?.remove,
        'later'
      );
      await server.client.db().command({ collMod: 'rejected', validator: {} });
      await save(item);
      assert.strictEqual(item.get('_rev'), 2);
      assert.strictEqual(
        (
          await server.client
            .db()
            .collection('rejected')
            .findOne({ _id: new ObjectId(String(item.id)) })
        )?.remove,
        undefined
      );
      assert.strictEqual(successes, 2);
      assert.strictEqual(errors, 1);
    } finally {
      await control.destroy();
    }
  });

  it('allows exactly one concurrent revision winner and rejects missing/empty reads precisely', async () => {
    class Race extends Backbone.Model {
      urlRoot = `${server.uri}/race`;
    }
    Race.prototype.sync = Mongo.sync(Race);
    const control = connection(Race);
    try {
      const initial = new Race({ name: 'initial' });
      await save(initial);
      const first = new Race(initial.toJSON());
      const second = new Race(initial.toJSON());
      const outcomes = await Promise.allSettled([save(first, { name: 'first' }), save(second, { name: 'second' })]);
      assert.strictEqual(outcomes.filter((value) => value.status === 'fulfilled').length, 1);
      const rejection = outcomes.find((value) => value.status === 'rejected');
      assert.ok(rejection?.status === 'rejected' && rejection.reason instanceof Error);
      assert.match(rejection.reason.message, /revision \(_rev\) was stale/);
      assert.strictEqual((await (await collection(control)).findOne({ _id: new ObjectId(String(initial.id)) }))?._rev, 2);
      await assert.rejects(fetch(new Race({ id: new ObjectId().toHexString() })), /Model not found/);
      const empty = call(Race, 'cursor', [{ name: 'missing' }]);
      assert.ok(empty && typeof empty === 'object');
      assert.deepStrictEqual(await result((cb) => call(empty, 'toJSON', [cb])), []);
      const page = call(Race, 'cursor', [{ $page: true, $offset: 0, $limit: 1 }]);
      assert.ok(page && typeof page === 'object');
      const pageResult = await result((cb) => call(page, 'toJSON', [cb]));
      assert.ok(pageResult && typeof pageResult === 'object');
      assert.strictEqual(Reflect.get(pageResult, 'total_rows'), 1);
      assert.strictEqual(Reflect.get(pageResult, 'offset'), 0);
      const projection = call(Race, 'cursor', [{ $values: ['_rev'] }]);
      assert.ok(projection && typeof projection === 'object');
      assert.deepStrictEqual(await result((cb) => call(projection, 'toJSON', [cb])), [2]);
    } finally {
      await control.destroy();
    }
  });

  it('settles concurrent connect failure, pending destroy and pool disposal without leaking clients', async () => {
    class Unreachable extends Backbone.Model {
      urlRoot = 'mongodb://127.0.0.1:1/failure/items';
    }
    Unreachable.prototype.sync = Mongo.sync(Unreachable, { serverSelectionTimeoutMS: 80 });
    const failed = connection(Unreachable);
    const outcomes = await Promise.allSettled([collection(failed), collection(failed)]);
    for (const outcome of outcomes) {
      assert.strictEqual(outcome.status, 'rejected');
    }
    assert.strictEqual(ORM.ConnectionPool.get(failed.url), undefined);
    await failed.destroy();
    class Pending extends Backbone.Model {
      urlRoot = `${server.uri}/pending`;
    }
    Pending.prototype.sync = Mongo.sync(Pending);
    const pending = connection(Pending);
    const waiting = collection(pending);
    const released = pending.destroy();
    await assert.rejects(waiting, /closed/);
    await released;
    assert.strictEqual(ORM.ConnectionPool.get(pending.url), undefined);
    class Disposed extends Backbone.Model {
      urlRoot = `${server.uri}/disposed`;
    }
    Disposed.prototype.sync = Mongo.sync(Disposed);
    const disposed = connection(Disposed);
    await collection(disposed);
    const pooled: unknown = ORM.ConnectionPool.get(disposed.url);
    assert.ok(pooled instanceof MongoClient);
    let closes = 0;
    pooled.on('topologyClosed', () => {
      closes += 1;
    });
    await Promise.all([ORM.ConnectionPool.dispose(disposed.url), disposed.destroy()]);
    assert.strictEqual(closes, 1);
    await assert.rejects(collection(disposed), /closed/);
  });

  it('does not absorb or renotify customer callback throws in owned real child processes', async () => {
    for (const mode of ['collection', 'collectionError', 'create', 'createError', 'relationInclude', 'relationIncludeError', 'staticDestroy', 'staticDestroyError', 'dropTable', 'dropTableError', 'ensureIndex', 'ensureIndexError', 'createOrUpdateTable', 'createOrUpdateTableError', 'ensureSchema', 'ensureSchemaError', 'resetSchema', 'resetSchemaError']) {
      const child = await runOwnedProcess(process.execPath, [path.join(repository, 'node_modules/ts-swc-loaders/bin/cli.js'), path.join(repository, 'test/fixtures/callbackThrows.ts'), server.uri, mode], { cwd: repository, timeoutMs: 15_000 }).catch((error: unknown) => {
        console.error(`Callback fixture mode ${mode} failed:`, inspect(error, { depth: null, maxArrayLength: null, maxStringLength: null, colors: false }));
        throw error;
      });
      assert.strictEqual(child.status, 0, `${child.stdout}${child.stderr}`);
      assert.match(child.stdout, /callback throw escaped once; connection cleanup confirmed/);
    }
  });

  it('borrows real pool clients without closing them and rejects conflicting options/identity', async () => {
    class Borrowed extends Backbone.Model {
      urlRoot = `${server.uri}/borrowed`;
    }
    Borrowed.prototype.sync = Mongo.sync(Borrowed);
    const control = connection(Borrowed);
    const client = new MongoClient(server.uri);
    ORM.ConnectionPool.set(control.url, client);
    try {
      await collection(control);
      const native = client.db().collection('borrowed');
      await native.insertOne({ name: 'borrowed schema row', _rev: 7 });
      const before = await native.find({}).toArray();
      const namespaces = await client.db().listCollections({ name: 'borrowed' }).toArray();
      const db = call(Borrowed, 'db');
      assert.ok(typeof db === 'object' && db !== null);
      assert.deepStrictEqual(await schemaOutcome(db, 'ensureSchema'), [null]);
      assert.deepStrictEqual(await native.find({}).toArray(), before);
      assert.deepStrictEqual(await Promise.all([schemaOutcome(db, 'resetSchema'), schemaOutcome(db, 'ensureSchema', {})]), [[null], [null]]);
      assert.deepStrictEqual(await client.db().listCollections({ name: 'borrowed' }).toArray(), namespaces);
      await control.destroy();
      await assert.rejects(collection(control), /connection is closed/);
      const closed = await schemaOutcome(db, 'ensureSchema');
      assert.strictEqual(closed.length, 1);
      assert.ok(closed[0] instanceof Error);
      assert.match(closed[0].message, /connection is closed/);
      ORM.ConnectionPool.del(control.url);
      assert.strictEqual(await client.db().collection('borrowed').countDocuments(), 0);
    } finally {
      ORM.ConnectionPool.del(control.url);
      await control.destroy();
      await client.close();
    }
    class Mismatched extends Backbone.Model {
      urlRoot = `${server.uri}/mismatched`;
    }
    Mismatched.prototype.sync = Mongo.sync(Mismatched);
    const mismatch = connection(Mismatched);
    const foreign = new MongoClient(server.uri, { appName: 'different' });
    ORM.ConnectionPool.set(mismatch.url, foreign);
    try {
      await assert.rejects(collection(mismatch), /Borrowed Mongo client options/);
    } finally {
      ORM.ConnectionPool.del(mismatch.url);
      await mismatch.destroy();
      await foreign.close();
    }
    class OptionsA extends Backbone.Model {
      urlRoot = `${server.uri}/options_a`;
    }
    class OptionsB extends Backbone.Model {
      urlRoot = `${server.uri}/options_b`;
    }
    OptionsA.prototype.sync = Mongo.sync(OptionsA, { appName: 'first' });
    OptionsB.prototype.sync = Mongo.sync(OptionsB, { appName: 'second' });
    const a = connection(OptionsA);
    const b = connection(OptionsB);
    try {
      await collection(a);
      await assert.rejects(collection(b), /options conflict/);
      const replacement = new MongoClient(server.uri);
      ORM.ConnectionPool.set(a.url, replacement);
      try {
        await assert.rejects(collection(a), /pooled client was replaced/);
      } finally {
        ORM.ConnectionPool.del(a.url);
        await replacement.close();
      }
    } finally {
      await a.destroy();
      await b.destroy();
    }
  });

  for (const owned of [false, true]) {
    it(`preserves the original failed handshake and survives an ${owned ? 'owned' : 'borrowed'} pool replacement`, async () => {
      class UnreachableReplacement extends Backbone.Model {
        urlRoot = 'mongodb://127.0.0.1:1/failure/replaced';
      }
      UnreachableReplacement.prototype.sync = Mongo.sync(UnreachableReplacement, { serverSelectionTimeoutMS: 80 });
      const control = connection(UnreachableReplacement);
      const replacement = new MongoClient(server.uri);
      await replacement.connect();
      let replacementCloses = 0;
      replacement.on('topologyClosed', () => {
        replacementCloses += 1;
      });
      let originalCloses = 0;
      let notifications = 0;
      const outcome = new Promise<unknown>((resolve) =>
        control.collection((error, value) => {
          notifications += 1;
          resolve(error ?? value);
        })
      );
      await Promise.resolve();
      const original: unknown = ORM.ConnectionPool.get(control.url);
      assert.ok(original instanceof MongoClient);
      original.on('topologyClosed', () => {
        originalCloses += 1;
      });
      original.once('topologyOpening', () => {
        ORM.ConnectionPool.del(control.url);
        if (owned)
          ORM.ConnectionPool.setOwned(control.url, replacement, (client, callback) => {
            void client.close().then(
              () => callback(null),
              (error: unknown) => callback(error instanceof Error ? error : new Error('Replacement close failed'))
            );
          });
        else ORM.ConnectionPool.set(control.url, replacement);
      });
      try {
        const error = await outcome;
        assert.ok(error instanceof Error);
        assert.strictEqual(error.message, 'Mongo connection failed');
        assert.strictEqual(notifications, 1);
        assert.ok(ORM.ConnectionPool.get(control.url) === replacement, 'Replacement registration must survive original-client failure');
        assert.strictEqual(replacementCloses, 0);
        assert.strictEqual(await replacement.db().collection('replacement_probe').countDocuments(), 0);
        assert.strictEqual(originalCloses, 1);
        await control.destroy();
        assert.strictEqual(originalCloses, 1);
      } finally {
        ORM.ConnectionPool.del(control.url);
        await control.destroy();
        await replacement.close();
      }
    });

    it(`rejects dispatch after a successful handshake replaces the client with an ${owned ? 'owned' : 'borrowed'} entry`, async () => {
      class HandshakeReplacement extends Backbone.Model {
        urlRoot = `${server.uri}/handshake_replaced`;
      }
      HandshakeReplacement.prototype.sync = Mongo.sync(HandshakeReplacement);
      const control = connection(HandshakeReplacement);
      const replacement = new MongoClient(server.uri);
      await replacement.connect();
      let replacementCloses = 0;
      replacement.on('topologyClosed', () => {
        replacementCloses += 1;
      });
      const outcome = collection(control).then(
        (value) => value,
        (error: unknown) => error
      );
      await Promise.resolve();
      const original: unknown = ORM.ConnectionPool.get(control.url);
      assert.ok(original instanceof MongoClient);
      let originalCloses = 0;
      original.on('topologyClosed', () => {
        originalCloses += 1;
      });
      original.once('topologyOpening', () => {
        ORM.ConnectionPool.del(control.url);
        if (owned)
          ORM.ConnectionPool.setOwned(control.url, replacement, (client, callback) => {
            void client.close().then(
              () => callback(null),
              (error: unknown) => callback(error instanceof Error ? error : new Error('Replacement close failed'))
            );
          });
        else ORM.ConnectionPool.set(control.url, replacement);
      });
      try {
        const error = await outcome;
        assert.ok(error instanceof Error, 'A replaced handshake must not dispatch a native collection');
        assert.match(error.message, /pooled client was replaced/);
        await control.destroy();
        assert.strictEqual(originalCloses, 1);
        assert.strictEqual(ORM.ConnectionPool.get(control.url), replacement);
        assert.strictEqual(replacementCloses, 0);
        assert.strictEqual(await replacement.db().collection('replacement_probe').countDocuments(), 0);
      } finally {
        ORM.ConnectionPool.del(control.url);
        await control.destroy();
        await replacement.close();
      }
    });
  }

  it('preserves the original connection failure alongside a public disposer failure', async () => {
    class CleanupFailure extends Backbone.Model {
      urlRoot = 'mongodb://127.0.0.1:1/failure/cleanup_failure';
    }
    CleanupFailure.prototype.sync = Mongo.sync(CleanupFailure, { serverSelectionTimeoutMS: 80 });
    const control = connection(CleanupFailure);
    let notifications = 0;
    const outcome = new Promise<unknown>((resolve) =>
      control.collection((error, value) => {
        notifications += 1;
        resolve(error ?? value);
      })
    );
    await Promise.resolve();
    const original: unknown = ORM.ConnectionPool.get(control.url);
    assert.ok(original instanceof MongoClient);
    const cleanupFailure = new Error('Consumer disposer failed after real client close');
    original.once('topologyOpening', () => {
      ORM.ConnectionPool.del(control.url);
      ORM.ConnectionPool.setOwned(control.url, original, (client, callback) => {
        void client.close().then(
          () => callback(cleanupFailure),
          (error: unknown) => callback(error instanceof Error ? error : new Error('Original close failed'))
        );
      });
    });
    try {
      const error = await outcome;
      assert.ok(error instanceof AggregateError);
      const [connectionFailure, cleanup] = error.errors;
      assert.ok(connectionFailure instanceof Error);
      assert.strictEqual(connectionFailure.message, 'Mongo connection failed');
      assert.strictEqual(cleanup, cleanupFailure);
      assert.strictEqual(notifications, 1);
    } finally {
      ORM.ConnectionPool.del(control.url);
      await control.destroy();
      await original.close();
    }
  });

  for (const release of ['pool', 'connection']) {
    it(`does not dispatch when ${release} disposal starts during a real handshake`, async () => {
      class HandshakeDisposed extends Backbone.Model {
        urlRoot = `${server.uri}/handshake_disposed`;
      }
      HandshakeDisposed.prototype.sync = Mongo.sync(HandshakeDisposed);
      const control = connection(HandshakeDisposed);
      const outcome = collection(control).then(
        (value) => value,
        (error: unknown) => error
      );
      await Promise.resolve();
      const original: unknown = ORM.ConnectionPool.get(control.url);
      assert.ok(original instanceof MongoClient);
      let closes = 0;
      let disposed: Promise<void> | undefined;
      original.on('topologyClosed', () => {
        closes += 1;
      });
      original.once('topologyOpening', () => {
        disposed = release === 'pool' ? ORM.ConnectionPool.dispose(control.url) : control.destroy();
      });
      try {
        const error = await outcome;
        assert.ok(error instanceof Error, 'A closing handshake must not dispatch a native collection');
        assert.match(error.message, /closed/);
        assert.ok(disposed);
        await disposed;
        await control.destroy();
        assert.strictEqual(closes, 1);
        assert.strictEqual(ORM.ConnectionPool.get(control.url), undefined);
      } finally {
        await disposed;
        await control.destroy();
      }
    });
  }

  it('forwards generated collection options and rejects incompatible configured model reuse without mutation', async () => {
    class Generated extends Backbone.Collection {}
    Generated.prototype.url = `${server.uri}/generated_options`;
    Generated.prototype.sync = Mongo.sync(Generated, { appName: 'collection-owner' });
    const modelType = Generated.prototype.model;
    const control = connection(modelType);
    try {
      const rows = new Generated();
      await fetch(rows);
      assert.strictEqual(rows.length, 0);
      const client: unknown = ORM.ConnectionPool.get(control.url);
      assert.ok(client instanceof MongoClient);
      assert.strictEqual(client.options.appName, 'collection-owner');
      const priorModelSync = modelType.prototype.sync;
      const priorCollectionSync = Generated.prototype.sync;
      assert.strictEqual(Mongo.sync(Generated, { appName: 'collection-owner' }), priorModelSync);
      assert.throws(() => Mongo.sync(Generated, { appName: 'incompatible' }), /different sync or options/);
      assert.strictEqual(modelType.prototype.sync, priorModelSync);
      assert.strictEqual(Generated.prototype.sync, priorCollectionSync);
      assert.strictEqual(ORM.ConnectionPool.get(control.url), client);
    } finally {
      await control.destroy();
    }
  });

  it('does not replace a collection model configured by a different adapter owner', () => {
    class Foreign extends Backbone.Model {
      urlRoot = `${server.uri}/foreign_owner`;
    }
    Foreign.prototype.sync = ORM.sync(Foreign);
    class ForeignRows extends Backbone.Collection<Foreign> {}
    ForeignRows.prototype.model = Foreign;
    const previous = Foreign.prototype.sync;
    assert.throws(() => Mongo.sync(ForeignRows, { appName: 'incompatible' }), /different sync owner/);
    assert.strictEqual(Foreign.prototype.sync, previous);
  });

  it('rejects forceServerObjectId from JavaScript and global options before model or native mutation', async () => {
    class ServerIdentity extends Backbone.Model {
      urlRoot = `${server.uri}/server_identity_rejected`;
    }
    const previous = ServerIdentity.prototype.sync;
    assert.throws(() => Reflect.apply(Mongo.sync, Mongo, [ServerIdentity, { forceServerObjectId: true }]), /forceServerObjectId/);
    assert.strictEqual(ServerIdentity.prototype.sync, previous);
    assert.throws(() => Reflect.apply(Mongo.configure, Mongo, [{ connection_options: { forceServerObjectId: true } }]), /forceServerObjectId/);
    ServerIdentity.prototype.sync = Mongo.sync(ServerIdentity, { forceServerObjectId: false });
    const control = connection(ServerIdentity);
    try {
      assert.strictEqual(await server.client.db().collection('server_identity_rejected').countDocuments(), 0);
      const input = { name: 'client-generated-id' };
      const model = new ServerIdentity(input);
      await save(model);
      assert.strictEqual(model.isNew(), false);
      assert.match(String(model.id), /^[0-9a-f]{24}$/);
      assert.deepStrictEqual(input, { name: 'client-generated-id' });
    } finally {
      await control.destroy();
    }
    class URIIdentity extends Backbone.Model {
      urlRoot = `${server.uri}/server_identity_uri?forceServerObjectId=true`;
    }
    URIIdentity.prototype.sync = Mongo.sync(URIIdentity);
    const uriControl = connection(URIIdentity);
    try {
      const input = { name: 'not-written' };
      const model = new URIIdentity(input);
      await assert.rejects(save(model), /forceServerObjectId/);
      assert.strictEqual(model.isNew(), true);
      assert.deepStrictEqual(input, { name: 'not-written' });
      assert.strictEqual(await server.client.db().collection('server_identity_uri').countDocuments(), 0);
      assert.strictEqual(ORM.ConnectionPool.get(uriControl.url), undefined);
    } finally {
      await uriControl.destroy();
    }
  });

  describe('public Mongo query contract', () => {
    for (const enabled of [false, true]) {
      for (const manual of [false, true]) {
        const cell = `cache ${enabled ? 'on' : 'off'}, ${manual ? 'manual zero' : 'native ObjectId'}`;
        let sequence = 0;
        const ids = manual ? [0, 1, 2, 3] : ['000000000000000000000001', '000000000000000000000002', '000000000000000000000003', '000000000000000000000004'];

        async function withCorpus(exercise: (type: object, control: MongoConnectionControl) => Promise<void>): Promise<void> {
          let control: MongoConnectionControl | undefined;
          let failed = false;
          let failure: unknown;
          const cleanupErrors: unknown[] = [];
          try {
            ORM.configure({ model_cache: { enabled, max: 100 } });
            const table = `query_${enabled ? 'on' : 'off'}_${manual ? 'manual' : 'native'}_${sequence++}`;
            class QueryItem extends Backbone.Model {
              urlRoot = `${server.uri}/${table}`;
              schema() {
                return manual ? { id: ['Integer', { manual: true }] } : {};
              }
            }
            const sync = Mongo.sync(QueryItem);
            QueryItem.prototype.sync = sync;
            assert.strictEqual(Mongo.sync(QueryItem), sync);
            assert.strictEqual(QueryItem.prototype.sync, sync);
            assert.strictEqual(Mongo.sync.capabilities().manual_ids, true);
            assert.strictEqual(Mongo.sync.capabilities().embed, false);
            control = connection(QueryItem);
            const native = await collection(control);
            await native.insertMany(
              [
                { name: 'alpha', score: 10, profile: { rank: 1, id: 'embedded-alpha' }, tags: ['red'], optional: null, created: new Date('2020-01-01T00:00:00.000Z') },
                { name: 'bravo', score: 20, profile: { rank: 2, id: 'embedded-bravo' }, tags: ['blue'], created: new Date('2020-01-02T00:00:00.000Z') },
                { name: 'charlie', score: 20, profile: { rank: 3, id: 'embedded-charlie' }, tags: ['red', 'blue'], optional: 'yes', created: new Date('2020-01-03T00:00:00.000Z') },
                { name: 'delta', score: 30, profile: { rank: 4, id: 'embedded-delta' }, tags: [], created: new Date('2020-01-04T00:00:00.000Z') },
              ].map((row, index) => (manual ? { ...row, id: ids[index], _rev: 1 } : { ...row, _id: new ObjectId(String(ids[index])), _rev: 1 }))
            );
            await exercise(QueryItem, control);
          } catch (error: unknown) {
            failed = true;
            failure = error;
          } finally {
            try {
              if (control) await control.destroy();
            } catch (error: unknown) {
              cleanupErrors.push(error);
            }
            try {
              ORM.configure({ model_cache: { enabled: false } });
            } catch (error: unknown) {
              cleanupErrors.push(error);
            }
          }
          if (cleanupErrors.length) throw new AggregateError(failed ? [failure, ...cleanupErrors] : cleanupErrors, 'Query corpus operation/cleanup failed');
          if (failed) throw failure;
          if (control) assert.strictEqual(ORM.ConnectionPool.get(control.url), undefined);
        }

        it(`queries stored nested paths and literal embedded ids without conversion (${cell})`, async () => {
          await withCorpus(async (type) => {
            assert.deepStrictEqual(await queryNames(type, { 'profile.rank': 2 }), ['bravo']);
            assert.deepStrictEqual(await queryNames(type, { 'profile.id': 'embedded-charlie' }), ['charlie']);
            assert.deepStrictEqual(await queryNames(type, { profile: { rank: 2, id: 'embedded-bravo' } }), ['bravo']);
            assert.deepStrictEqual(await queryNames(type, { profile: { rank: 2 } }), []);
            assert.deepStrictEqual(await queryNames(type, { 'tags.0': 'red', $sort: 'name' }), ['alpha', 'charlie']);
            assert.deepStrictEqual(await queryNames(type, { created: { $gte: new Date('2020-01-03T00:00:00.000Z') }, $sort: 'name' }), ['charlie', 'delta']);
            assert.deepStrictEqual(await queryNames(type, { name: /^br/ }), ['bravo']);
          });
        });

        it(`executes named comparison and membership predicates (${cell})`, async () => {
          await withCorpus(async (type) => {
            const cases: readonly [Record<string, unknown>, readonly string[]][] = [
              [{ $eq: 20 }, ['bravo', 'charlie']],
              [{ $ne: 20 }, ['alpha', 'delta']],
              [{ $gt: 20 }, ['delta']],
              [{ $gte: 20 }, ['bravo', 'charlie', 'delta']],
              [{ $lt: 20 }, ['alpha']],
              [{ $lte: 20 }, ['alpha', 'bravo', 'charlie']],
              [{ $in: [10, 30] }, ['alpha', 'delta']],
              [{ $nin: [10, 30] }, ['bravo', 'charlie']],
              [{ $gte: 20, $lt: 30 }, ['bravo', 'charlie']],
              [{ $in: [] }, []],
              [{ $nin: [] }, ['alpha', 'bravo', 'charlie', 'delta']],
            ];
            for (const [predicate, expected] of cases) assert.deepStrictEqual(await queryNames(type, { score: predicate, $sort: 'name' }), expected);
            assert.deepStrictEqual(await queryNames(type, { tags: { $in: ['red'] }, $sort: 'name' }), ['alpha', 'charlie']);
            assert.deepStrictEqual(await queryNames(type, { tags: { $in: [/^bl/] }, $sort: 'name' }), ['bravo', 'charlie']);
            assert.deepStrictEqual(await queryNames(type, { profile: { $eq: { rank: 2, id: 'embedded-bravo' } } }), ['bravo']);
          });
        });

        it(`executes recursive logical predicates and distinguishes field/result exists (${cell})`, async () => {
          await withCorpus(async (type) => {
            const branches = [{ score: 10 }, { 'profile.rank': 3 }];
            assert.deepStrictEqual(await queryNames(type, { $or: branches, $sort: 'name' }), ['alpha', 'charlie']);
            assert.deepStrictEqual(await queryNames(type, { find: { $or: branches }, cursor: { $sort: 'name' } }), ['alpha', 'charlie']);
            assert.deepStrictEqual(await queryNames(type, { find: {}, cursor: { $or: branches, $sort: 'name' } }), ['alpha', 'charlie']);
            assert.deepStrictEqual(await queryNames(type, { $and: [{ score: { $gte: 20 } }, { $or: [{ 'profile.rank': 2 }, { 'profile.rank': 4 }] }], $sort: 'name' }), ['bravo', 'delta']);
            assert.deepStrictEqual(await queryNames(type, { $nor: [{ score: 10 }, { score: 30 }], $sort: 'name' }), ['bravo', 'charlie']);
            assert.deepStrictEqual(await queryNames(type, { optional: { $exists: true }, $sort: 'name' }), ['alpha', 'charlie']);
            assert.deepStrictEqual(await queryNames(type, { optional: { $exists: false }, $sort: 'name' }), ['bravo', 'delta']);
            assert.deepStrictEqual(await queryNames(type, { optional: { $not: { $eq: 'yes' } }, $sort: 'name' }), ['alpha', 'bravo', 'delta']);
            assert.deepStrictEqual(await queryNames(type, { name: { $not: /^br/ }, $sort: 'name' }), ['alpha', 'charlie', 'delta']);
            assert.strictEqual(await queryJSON(type, { optional: { $exists: false }, $exists: true }), true);
            const selections: readonly [string, readonly number[]][] = [
              ['$and', [1, 2]],
              ['$or', [1, 2]],
              ['$nor', [0, 3]],
            ];
            const names = ['alpha', 'bravo', 'charlie', 'delta'];
            for (const [operator, selected] of selections) {
              const chosen = Object.freeze([Object.freeze({ score: 20 })]);
              for (const overwritten of [Object.freeze([Object.freeze({ score: 10 })]), Object.freeze([]), 'malformed', Object.freeze([1])]) {
                const find = Object.freeze({ [operator]: overwritten });
                const cursor = Object.freeze({ [operator]: chosen, $sort: 'name' });
                const query = Object.freeze({ find, cursor });
                assert.deepStrictEqual(
                  await queryNames(type, query),
                  selected.map((index) => names[index])
                );
                assert.strictEqual(await queryJSON(type, { find, cursor: { ...cursor, $count: true } }), selected.length);
                assert.deepStrictEqual(await queryJSON(type, { find, cursor: { ...cursor, $page: true, $offset: 1, $limit: 1, $select: ['id', 'name'] } }), {
                  offset: 1,
                  total_rows: selected.length,
                  rows: [{ id: ids[selected[1]], name: names[selected[1]] }],
                });
                assert.deepStrictEqual(query, { find: { [operator]: overwritten }, cursor: { [operator]: [{ score: 20 }], $sort: 'name' } });
                assert.strictEqual(find[operator], overwritten);
                assert.strictEqual(cursor[operator], chosen);
              }
            }
          });
        });

        it(`maps only root ID operands and retains ids/raw ID precedence (${cell})`, async () => {
          await withCorpus(async (type, control) => {
            const cases: readonly [Record<string, unknown>, readonly string[]][] = [
              [{ $eq: ids[0] }, ['alpha']],
              [{ $ne: ids[0] }, ['bravo', 'charlie', 'delta']],
              [{ $gt: ids[1] }, ['charlie', 'delta']],
              [{ $gte: ids[1] }, ['bravo', 'charlie', 'delta']],
              [{ $lt: ids[1] }, ['alpha']],
              [{ $lte: ids[1] }, ['alpha', 'bravo']],
              [{ $in: [ids[0], ids[2]] }, ['alpha', 'charlie']],
              [{ $nin: [ids[0], ids[2]] }, ['bravo', 'delta']],
              [{ $not: { $eq: ids[0] } }, ['bravo', 'charlie', 'delta']],
              [{ $exists: true }, ['alpha', 'bravo', 'charlie', 'delta']],
            ];
            for (const [predicate, expected] of cases) assert.deepStrictEqual(await queryNames(type, { id: predicate, $sort: 'name' }), expected);
            assert.deepStrictEqual(await queryNames(type, { $or: [{ id: ids[0] }, { id: { $in: [ids[3]] } }], $sort: 'name' }), ['alpha', 'delta']);
            assert.deepStrictEqual(await queryNames(type, { id: ids[0], $ids: [ids[1]] }), ['bravo']);
            assert.deepStrictEqual(await queryNames(type, { id: ids[0], $ids: [] }), []);
            if (manual) {
              assert.deepStrictEqual(await queryNames(type, { id: '0' }), []);
              const native = await collection(control);
              await native.insertOne({ id: 'manual-string', name: 'string-owner', _rev: 1 });
              assert.deepStrictEqual(await queryJSON(type, { id: { $eq: 'manual-string' }, $one: true }), { id: 'manual-string', name: 'string-owner', _rev: 1 });
            } else {
              const first = new ObjectId(String(ids[0]));
              const second = new ObjectId(String(ids[1]));
              assert.deepStrictEqual(await queryNames(type, { id: { $in: [first, String(ids[2])] }, $sort: 'name' }), ['alpha', 'charlie']);
              assert.deepStrictEqual(await queryNames(type, { id: ids[0], _id: second }), ['bravo']);
              assert.deepStrictEqual(await queryNames(type, { _id: second, id: ids[0] }), ['alpha']);
              assert.strictEqual(first.toHexString(), ids[0]);
              await assert.rejects(queryJSON(type, { id: { $in: ['bad'] } }), /Invalid default Mongo id/);
            }
          });
        });

        it(`uses the same predicate for ordered rows, projections, count and page (${cell})`, async () => {
          await withCorpus(async (type) => {
            assert.deepStrictEqual(await queryNames(type, { score: { $gte: 20 }, $sort: [' - profile.rank ', 'name'], $offset: 1, $limit: 1 }), ['charlie']);
            assert.deepStrictEqual(await queryNames(type, { score: { $gte: 20 }, $sort: ['score', '-name'] }), ['charlie', 'bravo', 'delta']);
            assert.deepStrictEqual(await queryJSON(type, { 'profile.rank': 2, $select: ['id', 'name'] }), [{ id: ids[1], name: 'bravo' }]);
            assert.deepStrictEqual(await queryJSON(type, { 'profile.rank': 2, $select: ['id', 'name'], $whitelist: ['name'] }), [{ name: 'bravo' }]);
            assert.deepStrictEqual(await queryJSON(type, { 'profile.rank': 2, $select: ['profile'] }), [{ profile: { rank: 2, id: 'embedded-bravo' } }]);
            assert.deepStrictEqual(await queryJSON(type, { score: { $gte: 20 }, $sort: 'name', $values: ['name'] }), ['bravo', 'charlie', 'delta']);
            const predicate = { $and: [{ score: { $gte: 20 } }, { $or: [{ 'profile.rank': 2 }, { 'profile.rank': 4 }] }] };
            assert.strictEqual(await queryJSON(type, { ...predicate, $count: true, $offset: 99, $limit: 0 }), 2);
            assert.strictEqual(await queryJSON(type, { ...predicate, $exists: true, $offset: 99, $limit: 0 }), true);
            const page = await queryJSON(type, { ...predicate, $sort: 'name', $page: true, $offset: 1, $limit: 1, $select: ['id', 'name'] });
            assert.deepStrictEqual(page, { offset: 1, total_rows: 2, rows: [{ id: ids[3], name: 'delta' }] });
            assert.deepStrictEqual(await queryJSON(type, { ...predicate, $page: true, $offset: 99, $limit: 1 }), { offset: 99, total_rows: 2, rows: [] });
            assert.deepStrictEqual(await queryJSON(type, { ...predicate, $page: true, $limit: 0 }), { offset: 0, total_rows: 2, rows: [] });
            assert.strictEqual(await queryJSON(type, { 'profile.rank': 99, $one: true }), null);
            assert.strictEqual(await queryJSON(type, { 'profile.rank': 99, $count: true }), 0);
            assert.strictEqual(await queryJSON(type, { 'profile.rank': 99, $exists: true }), false);
            assert.deepStrictEqual(await queryJSON(type, { ...predicate, $sort: 'id', $select: ['id'] }), [{ id: ids[1] }, { id: ids[3] }]);
          });
        });

        it(`preserves frozen inputs and full materialization identity on repeat (${cell})`, async () => {
          await withCorpus(async (type) => {
            const date = new Date('2020-01-01T00:00:00.000Z');
            const expression = /^a/;
            const nativeId = manual ? 0 : new ObjectId(String(ids[0]));
            const query = Object.freeze({
              $and: Object.freeze([Object.freeze({ id: Object.freeze({ $in: Object.freeze([nativeId]) }) }), Object.freeze({ 'profile.id': 'embedded-alpha' }), Object.freeze({ created: Object.freeze({ $gte: date }) }), Object.freeze({ name: expression })]),
              $sort: Object.freeze([' - profile.rank ', 'name']),
            });
            const cursor = publicCursor(type, query);
            const first = await materialize(cursor);
            const second = await materialize(cursor);
            const found = await findModels(type, query);
            const repeated = await findModels(type, query);
            for (const models of [first, second, found, repeated]) {
              assert.strictEqual(models.length, 1);
              assert.strictEqual(models[0].constructor, type);
              assert.strictEqual(models[0].id, ids[0]);
              assert.strictEqual(models[0].get('name'), 'alpha');
              assert.deepStrictEqual(models[0].get('profile'), { rank: 1, id: 'embedded-alpha' });
              assert.strictEqual(models[0].get('_rev'), 1);
              assert.strictEqual(Reflect.getOwnPropertyDescriptor(models[0].attributes, '_id'), undefined);
            }
            for (const models of [second, found, repeated]) {
              if (enabled) assert.strictEqual(models[0], first[0]);
              else assert.notStrictEqual(models[0], first[0]);
            }
            assert.deepStrictEqual(query, { $and: [{ id: { $in: [nativeId] } }, { 'profile.id': 'embedded-alpha' }, { created: { $gte: new Date('2020-01-01T00:00:00.000Z') } }, { name: /^a/ }], $sort: [' - profile.rank ', 'name'] });
            assert.strictEqual(date.getTime(), 1577836800000);
            assert.strictEqual(expression.source, '^a');
            assert.strictEqual(expression.flags, '');
            assert.strictEqual(expression.lastIndex, 0);
            if (nativeId instanceof ObjectId) assert.strictEqual(nativeId.toHexString(), ids[0]);
            assert.deepStrictEqual(Object.keys(query), ['$and', '$sort']);
            const invalid = Object.freeze({ score: Object.freeze({ $in: 20 }) });
            await assert.rejects(queryJSON(type, invalid), /score\.\$in requires an array/);
            assert.deepStrictEqual(invalid, { score: { $in: 20 } });
          });
        });

        it(`rejects unsupported or malformed predicates without changing construction phase (${cell})`, async () => {
          await withCorpus(async (type) => {
            const cases: readonly [unknown, RegExp][] = [
              [{ $and: [] }, /\$and requires a nonempty array/],
              [{ $or: 'bad' }, /\$or requires a nonempty array/],
              [{ $nor: [1] }, /predicates require query documents/],
              [{ score: { $in: 20 } }, /score\.\$in requires an array/],
              [{ score: { $nin: 20 } }, /score\.\$nin requires an array/],
              [{ score: { $exists: 1 } }, /score\.\$exists requires a boolean/],
              [{ score: { $not: 20 } }, /score\.\$not requires an operator expression/],
              [{ score: { $gte: 20, literal: 1 } }, /predicate operator is not implemented: score.literal/],
              [{ tags: { $elemMatch: { $eq: 'red' } } }, /predicate operator is not implemented: tags\.\$elemMatch/],
              [{ name: { $regex: 'alpha' } }, /predicate operator is not implemented: name\.\$regex/],
              [{ $and: [{ $limit: 1 }] }, /query operator is not implemented: \$limit/],
              [{ $where: 'true' }, /cursor control is not implemented: \$where/],
              [{ $include: ['profile'] }, /Mongo include requires a declared relation key: profile/],
              [{ $unique: ['name'] }, /cursor control is not implemented: \$unique/],
            ];
            for (const [query, expected] of cases) await assert.rejects(queryJSON(type, query), expected);
            assert.throws(() => publicCursor(type, { score: undefined }), /Unexpected undefined for query key 'score'/);
          });
        });
        it(`preserves prototype-named fields as literal query/sort data (${cell})`, async () => {
          await withCorpus(async (type, control) => {
            const native = await collection(control);
            const profile = Object.fromEntries([
              ['__proto__', 'embedded-prototype'],
              ['constructor', 'embedded-constructor'],
              ['toString', 'embedded-string'],
            ]);
            const first = Object.fromEntries([
              ['__proto__', 1],
              ['constructor', 'literal-constructor'],
              ['toString', 'literal-string'],
              ['name', 'zeta'],
              ['marker', 'prototype-sort'],
              ['profile', profile],
              ['_rev', 1],
              [manual ? 'id' : '_id', manual ? 5 : new ObjectId('000000000000000000000005')],
            ]);
            const second = Object.fromEntries([
              ['__proto__', 2],
              ['constructor', 'literal-constructor'],
              ['toString', 'literal-string'],
              ['name', 'epsilon'],
              ['marker', 'prototype-sort'],
              ['profile', profile],
              ['_rev', 1],
              [manual ? 'id' : '_id', manual ? 6 : new ObjectId('000000000000000000000006')],
            ]);
            await native.insertMany([first, second]);
            const query = Object.fromEntries([['__proto__', 1]]);
            Object.setPrototypeOf(query, null);
            Object.freeze(query);
            assert.deepStrictEqual(await queryNames(type, query), ['zeta']);
            assert.strictEqual(await queryJSON(type, { find: query, cursor: { $count: true } }), 1);
            assert.strictEqual(await queryJSON(type, { find: query, cursor: { $exists: true } }), true);
            assert.strictEqual(Object.getPrototypeOf(query), null);
            assert.deepStrictEqual(Object.keys(query), ['__proto__']);
            assert.strictEqual(Reflect.getOwnPropertyDescriptor(query, '__proto__')?.value, 1);
            assert.deepStrictEqual(await queryNames(type, { marker: 'prototype-sort', $sort: ['__proto__', 'name'] }), ['zeta', 'epsilon']);
            assert.deepStrictEqual(await queryNames(type, { constructor: 'literal-constructor', $sort: 'name' }), ['epsilon', 'zeta']);
            assert.deepStrictEqual(await queryNames(type, { toString: 'literal-string', $sort: 'name' }), ['epsilon', 'zeta']);
            assert.deepStrictEqual(await queryNames(type, { profile, $sort: 'name' }), ['epsilon', 'zeta']);
            const rows = await queryJSON(type, { marker: 'prototype-sort', $sort: 'name' });
            assert.ok(Array.isArray(rows));
            for (const row of rows) {
              assert.ok(typeof row === 'object' && row !== null);
              assert.strictEqual(Object.getPrototypeOf(row), Object.prototype);
              const embedded: unknown = Reflect.get(row, 'profile');
              assert.ok(typeof embedded === 'object' && embedded !== null);
              assert.strictEqual(Object.getPrototypeOf(embedded), Object.prototype);
              assert.strictEqual(Reflect.getOwnPropertyDescriptor(embedded, '__proto__')?.value, 'embedded-prototype');
              assert.strictEqual(Reflect.get(row, 'constructor'), 'literal-constructor');
              assert.strictEqual(Reflect.get(row, 'toString'), 'literal-string');
            }
            assert.strictEqual(Object.getPrototypeOf(profile), Object.prototype);
            assert.strictEqual(Reflect.getOwnPropertyDescriptor(profile, '__proto__')?.value, 'embedded-prototype');
          });
        });
      }
    }
  });
});
