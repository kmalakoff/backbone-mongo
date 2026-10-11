import { isDeepStrictEqual } from 'node:util';
import Backbone from 'backbone';
import BackboneORM, { type AdapterSync, type CollectionConstructor, type CursorCallback, type ErrorCallback, type ModelConstructor, type ModelSync, type PatchRemoveModelConstructor, type SchemaInstance } from 'backbone-orm';
import { ObjectId, type UpdateFilter } from 'mongodb';
import MongoCursor from './cursor.ts';
import MongoConnection from './lib/connection.ts';
import MongoDatabaseTools from './lib/database-tools.ts';
import DocumentCodec from './lib/document.ts';
import { MONGO_SYSTEM_FIELDS, type MongoRelationContext, type MongoRelationOwner, validateMongoForeignKeys, validateMongoRelationGraph, validateMongoRelations } from './lib/relations.ts';
import { driverError, operationCallback } from './lib/settle.ts';
import { copyValue, isRecord, stringList } from './lib/values.ts';
import type { MongoCapabilities, MongoDatabaseControl, MongoDatabaseOptions, MongoDocument, MongoSyncFactory, MongoSyncOptions } from './types.ts';

interface SyncOptions {
  error(error: Error): unknown;
  success(value?: unknown): unknown;
  query?: unknown;
}

function isSyncOptions(value: unknown): value is SyncOptions {
  return isRecord(value) && typeof value.success === 'function' && typeof value.error === 'function';
}

function requireOptions(value: unknown): SyncOptions {
  if (!isSyncOptions(value)) throw new Error('Mongo sync requires success and error callbacks');
  return value;
}

function hasSchemaControl(value: ModelConstructor<Backbone.Model>): value is PatchRemoveModelConstructor {
  return typeof Reflect.get(value, 'schema') === 'function';
}

function manualID(schema: SchemaInstance): boolean {
  const field = schema.fields.id;
  return field?.manual === true || field?.manual_id === true;
}

class MongoSync {
  readonly modelType: ModelConstructor<Backbone.Model>;
  readonly connection: MongoConnection;
  readonly schema: SchemaInstance;
  readonly table: string;
  private readonly codec: DocumentCodec;
  private readonly databaseControl: MongoDatabaseControl;
  private readonly pendingUnsets = new WeakMap<Backbone.Model, Set<string>>();

  constructor(modelType: ModelConstructor<Backbone.Model>, options: MongoSyncOptions) {
    this.modelType = modelType;
    const model = new modelType();
    if (model.idAttribute !== 'id') throw new Error('Mongo first slice requires the public id attribute');
    let url: unknown;
    try {
      url = model.url();
    } catch {
      throw new Error('Missing Mongo URL for model');
    }
    if (typeof url !== 'string') throw new Error('Missing Mongo URL for model');
    this.connection = new MongoConnection(url, options);
    this.table = this.connection.collectionName;
    modelType.model_name ??= BackboneORM.naming_conventions.modelName(this.table, false);
    this.schema = new BackboneORM.Schema(modelType, { id: { type: ObjectId } });
    this.codec = new DocumentCodec(manualID(this.schema));
    const tools = new MongoDatabaseTools(this.connection, this.schema, this.codec.idAttribute, () => this.validateGraph());
    this.databaseControl = {
      connection: this.connection,
      dropTable: tools.dropTable,
      ensureIndex: tools.ensureIndex,
      createOrUpdateTable: tools.createOrUpdateTable,
      ensureSchema: tools.ensureSchema,
      resetSchema: tools.resetSchema,
    };
  }

  initializeSchema(): void {
    this.schema.initialize();
    validateMongoRelations(this.relationOwner(true), (type) => this.resolveRelatedOwner(type, true));
  }

  validateGraph(): void {
    validateMongoRelationGraph(this.relationOwner(), (type) => this.resolveRelatedOwner(type));
  }

  private requireRegistration(allowInitializing = false): ModelRegistration {
    const registration = models.get(this.modelType);
    if (!registration || registration.implementation !== this) throw new Error('Mongo model registration was replaced');
    if (registration.state === 'failed') throw registration.failure ?? new Error('Mongo model configuration failed');
    if (registration.state === 'initializing' && !allowInitializing) throw new Error('Mongo model configuration is incomplete');
    if (this.modelType.prototype.sync !== registration.sync) throw new Error('Mongo model sync owner was replaced');
    const schemaProvider: unknown = Reflect.get(this.modelType, 'schema');
    if (typeof schemaProvider !== 'function' || Reflect.apply(schemaProvider, this.modelType, []) !== this.schema) throw new Error('Mongo model schema owner was replaced');
    return registration;
  }

  private relationOwner(allowInitializing = false): MongoRelationOwner {
    this.requireRegistration(allowInitializing);
    return {
      modelType: this.modelType,
      schema: this.schema,
      connection: this.connection,
      codec: this.codec,
      assertAvailable: () => {
        this.requireRegistration();
        this.connection.assertAvailable();
      },
      cursor: (query) => this.cursor(query),
    };
  }

  private resolveRelatedOwner(type: ModelConstructor<Backbone.Model>, allowInitializing = false): MongoRelationOwner {
    const registration = models.get(type);
    if (!registration) throw new Error('Mongo relation requires a registered Mongo model');
    if (!isDeepStrictEqual(registration.options, this.requireRegistration(allowInitializing).options)) throw new Error('Mongo relation connection options conflict');
    return registration.implementation.relationOwner(allowInitializing);
  }

  private relationContext(): MongoRelationContext {
    return { owner: this.relationOwner(), resolve: (type) => this.resolveRelatedOwner(type) };
  }

  cursor(query: unknown = {}): MongoCursor {
    return new MongoCursor(query, this.modelType, this.connection, this.codec, () => this.relationContext());
  }

  db(): MongoDatabaseControl {
    return this.databaseControl;
  }

  collection(callback: (error: Error | null, collection?: unknown) => void): void {
    this.connection.collection(callback);
  }

  dispatch(method: string, target?: unknown, optionsValue?: unknown): unknown {
    if (method === 'sync') return this;
    if (method === 'schema') return this.schema;
    if (method === 'tableName') return this.table;
    if (method === 'isRemote') return false;
    if (method === 'db') return this.db();
    if (method === 'initialize') {
      const registration = models.get(this.modelType);
      if (registration?.state === 'failed') throw registration.failure ?? new Error('Mongo model configuration failed');
      return;
    }
    if (method === 'cursor') return this.cursor(target);
    if (method === 'destroy') {
      const callback: unknown = typeof target === 'function' ? target : optionsValue;
      if (typeof callback !== 'function') throw new Error('destroy requires a callback');
      return operationCallback(
        () => this.destroy(typeof target === 'function' ? {} : target),
        (error, count) => {
          if (error) callback(error);
          else callback(null, count);
        }
      );
    }
    if (method === 'resetSchema') {
      const callback: unknown = typeof target === 'function' ? target : optionsValue;
      if (typeof callback !== 'function') throw new Error(`${method} requires a callback`);
      return typeof target === 'function' ? this.databaseControl.resetSchema(target as ErrorCallback) : this.databaseControl.resetSchema(target as MongoDatabaseOptions, callback as ErrorCallback);
    }
    if (method === 'collection') {
      if (typeof target !== 'function') throw new Error('Mongo collection requires a callback');
      return operationCallback(
        () => {
          this.validateGraph();
          return this.connection.use(async (collection) => {
            this.validateGraph();
            return collection;
          });
        },
        (error, collection) => target(error, collection)
      );
    }
    if (method === 'closeConnection') {
      if (target === undefined) return this.connection.destroy();
      if (typeof target !== 'function') throw new Error('Mongo closeConnection requires a callback');
      return this.connection.destroy((error) => target(error));
    }
    if (!['create', 'read', 'update', 'patch', 'delete'].includes(method)) return undefined;
    const options = requireOptions(optionsValue);
    operationCallback(
      async () => {
        if (method === 'read') return this.read(target, options.query);
        if (!(target instanceof Backbone.Model)) throw new Error('Mongo write requires the canonical Backbone model');
        this.validateGraph();
        if (method === 'create') return this.create(target);
        if (method === 'update' || method === 'patch') return this.update(target);
        return this.delete(target);
      },
      (error, value) => {
        if (error) options.error(error);
        else options.success(value);
      }
    );
    return;
  }

  private async read(target: unknown, query?: unknown): Promise<unknown> {
    if (target instanceof Backbone.Collection) return this.cursorResult(this.cursor(query));
    if (!(target instanceof Backbone.Model)) throw new Error('Mongo read requires the canonical Backbone model or collection');
    const json = await this.cursorResult(this.cursor({ id: target.id, $one: true }));
    if (json === null) throw new Error('Model not found');
    return json;
  }

  private cursorResult(cursor: MongoCursor): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const callback: CursorCallback = (error, value) => {
        if (error) reject(error);
        else resolve(value);
      };
      cursor.toJSON(callback);
    });
  }

  private async create(model: Backbone.Model): Promise<Record<string, unknown>> {
    if (this.codec.manual && (model.id === undefined || model.id === null)) throw new Error('Set a manual Mongo id before saving');
    if (model.get('_rev')) throw new Error('New document has a non-empty revision');
    const json: unknown = model.toJSON();
    if (!isRecord(json)) throw new Error('Mongo model JSON must be an object');
    const document = this.codec.attributesToNative(json);
    validateMongoForeignKeys(this.relationOwner(), document, (type) => this.resolveRelatedOwner(type));
    document._rev = 1;
    return this.connection.use(async (collection) => {
      this.validateGraph();
      validateMongoForeignKeys(this.relationOwner(), document, (type) => this.resolveRelatedOwner(type));
      try {
        const result = await collection.insertOne(document);
        if (!result.acknowledged) throw new Error('Insert was not acknowledged');
        document._id = result.insertedId;
      } catch (error: unknown) {
        throw driverError(error, 'create');
      }
      return this.codec.nativeToAttributes(document);
    });
  }

  private async update(model: Backbone.Model): Promise<Record<string, unknown>> {
    const revision: unknown = model.get('_rev');
    if (revision === undefined || revision === null || revision === 0) return this.create(model);
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1 || revision === Number.MAX_SAFE_INTEGER) throw new Error('Mongo _rev must be a positive safe integer');
    const json: unknown = model.toJSON();
    if (!isRecord(json)) throw new Error('Mongo model JSON must be an object');
    const document = this.codec.attributesToNative(json);
    validateMongoForeignKeys(this.relationOwner(), document, (type) => this.resolveRelatedOwner(type));
    delete document._id;
    document._rev = revision + 1;
    const filter = { ...this.codec.findId(model.id), _rev: revision };
    const pending = this.pendingUnsets.get(model) ?? new Set<string>();
    const publicUnsets: unknown = BackboneORM.Utils.get(model, 'unsets');
    if (publicUnsets !== undefined && publicUnsets !== null) for (const key of stringList(publicUnsets, 'Mongo unsets')) pending.add(key);
    this.pendingUnsets.set(model, pending);
    const unsets = [...pending].filter((key) => {
      const relation = this.schema.relation(key);
      const serializedForeignKey = relation?.type === 'belongsTo' && relation.foreign_key === key && Reflect.getOwnPropertyDescriptor(document, key) !== undefined;
      return !serializedForeignKey && Reflect.getOwnPropertyDescriptor(model.attributes, key) === undefined;
    });
    if (unsets.some((key) => MONGO_SYSTEM_FIELDS.has(key))) throw new Error('Cannot unset Mongo identity or revision');
    const modifications: UpdateFilter<MongoDocument> = { $set: document };
    if (unsets.length) modifications.$unset = Object.fromEntries(unsets.map((key) => [key, '']));
    return this.connection.use(async (collection) => {
      this.validateGraph();
      validateMongoForeignKeys(this.relationOwner(), document, (type) => this.resolveRelatedOwner(type));
      let result: MongoDocument | null;
      try {
        result = await collection.findOneAndUpdate(filter, modifications, { returnDocument: 'after', includeResultMetadata: false, upsert: false });
      } catch (error: unknown) {
        throw driverError(error, 'update');
      }
      if (!result) throw new Error('Failed to update model. Either the document has been deleted or the revision (_rev) was stale.');
      if (result._rev !== document._rev) throw new Error('Mongo update returned an unexpected revision');
      this.pendingUnsets.delete(model);
      return this.codec.nativeToAttributes(result);
    });
  }

  private async destroy(query: unknown): Promise<number> {
    this.validateGraph();
    await this.connection.use(async () => {
      this.validateGraph();
    });
    const each: unknown = Reflect.get(this.modelType, 'each');
    if (typeof each !== 'function') throw new Error('Mongo destroy requires the configured ORM each');
    return new Promise<number>((resolve, reject) => {
      Reflect.apply(each, this.modelType, [
        { $each: { limit: 1000, json: true }, ...(query as object) },
        (model: Backbone.Model | Record<string, unknown>, next: ErrorCallback) => operationCallback(() => this.delete(model), (error) => next(error)),
        (error: Error | null, count: number) => {
          if (error) reject(error);
          else resolve(count);
        },
      ]);
    });
  }

  private async delete(model: Backbone.Model | Record<string, unknown>): Promise<void> {
    const filter = this.codec.findId(model.id);
    await this.connection.use(async (collection) => {
      this.validateGraph();
      try {
        await collection.deleteMany(filter);
      } catch (error: unknown) {
        throw driverError(error, 'delete');
      }
      const modelType = this.modelType;
      if (!hasSchemaControl(modelType)) throw new Error('Mongo deletion requires the configured ORM schema');
      // Native deletion precedes ORM cleanup and cannot be rolled back if cleanup fails.
      await new Promise<void>((resolve, reject) => {
        BackboneORM.Utils.patchRemove(modelType, model, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      if (model instanceof Backbone.Model) this.pendingUnsets.delete(model);
    });
  }
}

interface ModelRegistration {
  readonly implementation: MongoSync;
  readonly options: MongoSyncOptions;
  sync: AdapterSync<MongoCursor, MongoDatabaseControl> | ModelSync;
  state: 'initializing' | 'ready' | 'failed';
  failure?: Error;
}

interface ModelConfiguration {
  depth: number;
  batch?: ModelRegistration[];
}

const MODEL_REGISTRY_KEY = Symbol.for('backbone-mongo.model-registry.v1');
const MODEL_CONFIGURATION_KEY = Symbol.for('backbone-mongo.model-registry.configuration.v1');

interface ModelRegistry extends WeakMap<ModelConstructor<Backbone.Model>, ModelRegistration> {
  readonly [MODEL_CONFIGURATION_KEY]?: ModelConfiguration;
}

function registry(): ModelRegistry {
  const existing: unknown = Reflect.get(globalThis, MODEL_REGISTRY_KEY);
  if (existing !== undefined) {
    if (!(existing instanceof WeakMap)) throw new Error('Invalid shared Mongo model registry');
    return existing;
  }
  const created = new WeakMap<ModelConstructor<Backbone.Model>, ModelRegistration>();
  Object.defineProperty(globalThis, MODEL_REGISTRY_KEY, { value: created });
  return created;
}

const models = registry();
const configuration: ModelConfiguration = models[MODEL_CONFIGURATION_KEY] ?? { depth: 0 };
if (models[MODEL_CONFIGURATION_KEY] === undefined) Object.defineProperty(models, MODEL_CONFIGURATION_KEY, { value: configuration });
let defaultOptions: MongoSyncOptions = {};

function validateConnectionOptions(options: MongoSyncOptions): void {
  const forceServerObjectId: unknown = Reflect.get(options, 'forceServerObjectId');
  if (forceServerObjectId === true) throw new Error('forceServerObjectId=true is unsupported; Mongo requires client-assigned native IDs');
}

export function configureConnections(options: MongoSyncOptions): void {
  const resolved = { ...defaultOptions, ...copyValue(options) };
  validateConnectionOptions(resolved);
  defaultOptions = resolved;
}

function isModelConstructor(value: unknown): value is ModelConstructor<Backbone.Model> {
  return typeof value === 'function' && (value === Backbone.Model || Reflect.get(value, 'prototype') instanceof Backbone.Model);
}

function isCollectionConstructor(value: ModelConstructor<Backbone.Model> | CollectionConstructor<Backbone.Collection>): value is CollectionConstructor<Backbone.Collection> {
  return typeof value === 'function' && Reflect.get(value, 'prototype') instanceof Backbone.Collection;
}

function sync<M extends Backbone.Model>(modelType: ModelConstructor<M>, options?: MongoSyncOptions): ModelSync;
function sync<C extends Backbone.Collection>(collectionType: CollectionConstructor<C>, options?: MongoSyncOptions): Backbone.Collection['sync'];
function sync(type: ModelConstructor<Backbone.Model> | CollectionConstructor<Backbone.Collection>, options: MongoSyncOptions = {}): ModelSync | Backbone.Collection['sync'] {
  const resolved = { ...defaultOptions, ...copyValue(options) };
  validateConnectionOptions(resolved);
  if (isCollectionConstructor(type)) {
    const previousModel = type.prototype.model;
    if (isModelConstructor(previousModel) && previousModel.prototype.sync !== Backbone.Model.prototype.sync && !models.has(previousModel)) throw new Error('Mongo collection model is already configured with a different sync owner');
    const modelType = BackboneORM.Utils.configureCollectionModelType(type, (model: ModelConstructor<Backbone.Model>) => sync(model, resolved));
    return sync(modelType, resolved);
  }
  if (!isModelConstructor(type)) throw new Error('Mongo sync requires the canonical Backbone model constructor');
  const existing = models.get(type);
  if (existing) {
    if (existing.state === 'failed') throw existing.failure ?? new Error('Mongo model configuration failed');
    if (existing.state === 'initializing' && configuration.depth === 0) throw new Error('Mongo model configuration is incomplete');
    if (!isDeepStrictEqual(existing.options, resolved)) throw new Error('Mongo model is already configured with a different sync or options');
    const currentSync = type.prototype.sync;
    if (currentSync !== existing.sync) throw new Error('Mongo model is already configured with a different sync or options');
    return currentSync;
  }
  if (type.prototype.sync !== Backbone.Model.prototype.sync) throw new Error('Mongo model is already configured with a different sync owner');
  const implementation = new MongoSync(type, resolved);
  function adapter(method: 'cursor', query?: unknown): MongoCursor;
  function adapter(method: 'db'): MongoDatabaseControl;
  function adapter(method: 'schema'): SchemaInstance;
  function adapter(method: 'tableName'): string;
  function adapter(method: 'isRemote'): false;
  function adapter(method: string, target?: unknown, optionsValue?: unknown): unknown;
  function adapter(method: string, target?: unknown, optionsValue?: unknown): unknown {
    if (method === 'createSync') {
      if (!isModelConstructor(target)) throw new Error('createSync requires a Backbone model constructor');
      return sync(target, resolved);
    }
    return implementation.dispatch(method, target, optionsValue);
  }
  const contract: AdapterSync<MongoCursor, MongoDatabaseControl> = adapter;
  const registration: ModelRegistration = { implementation, options: resolved, sync: contract, state: 'initializing' };
  if (configuration.depth === 0) configuration.batch = [];
  configuration.batch?.push(registration);
  models.set(type, registration);
  configuration.depth += 1;
  try {
    Reflect.set(type.prototype, 'sync', contract);
    BackboneORM.Utils.configureModelType(type);
    implementation.initializeSchema();
    const configured = BackboneORM.model_cache.configureSync(type, type.prototype.sync);
    registration.sync = configured;
    Reflect.set(type.prototype, 'sync', configured);
    registration.state = 'ready';
    if (configuration.depth === 1) implementation.validateGraph();
    return configured;
  } catch (error: unknown) {
    registration.failure = error instanceof Error ? error : new Error('Mongo schema configuration threw a non-Error value');
    registration.state = 'failed';
    if (configuration.depth === 1)
      for (const member of configuration.batch ?? []) {
        member.failure = registration.failure;
        member.state = 'failed';
      }
    throw registration.failure;
  } finally {
    configuration.depth -= 1;
    if (configuration.depth === 0) configuration.batch = undefined;
  }
}

const CAPABILITIES: MongoCapabilities = { dynamic: true, json: true, manual_ids: true, embed: false, self_reference: false, unique: false };
const syncFactory: MongoSyncFactory = Object.assign(sync, {
  capabilities(): MongoCapabilities {
    return { ...CAPABILITIES };
  },
});
export default syncFactory;
