var _models_MODEL_CONFIGURATION_KEY;
import { isDeepStrictEqual } from 'node:util';
import Backbone from 'backbone';
import BackboneORM from 'backbone-orm';
import { ObjectId } from 'mongodb';
import MongoCursor from './cursor.js';
import MongoConnection from './lib/connection.js';
import MongoDatabaseTools from './lib/database-tools.js';
import DocumentCodec from './lib/document.js';
import { MONGO_SYSTEM_FIELDS, validateMongoForeignKeys, validateMongoRelationGraph, validateMongoRelations } from './lib/relations.js';
import { driverError, operationCallback } from './lib/settle.js';
import { copyValue, isRecord, stringList } from './lib/values.js';
function isSyncOptions(value) {
    return isRecord(value) && typeof value.success === 'function' && typeof value.error === 'function';
}
function requireOptions(value) {
    if (!isSyncOptions(value)) throw new Error('Mongo sync requires success and error callbacks');
    return value;
}
function hasSchemaControl(value) {
    return typeof Reflect.get(value, 'schema') === 'function';
}
function manualID(schema) {
    const field = schema.fields.id;
    return (field === null || field === void 0 ? void 0 : field.manual) === true || (field === null || field === void 0 ? void 0 : field.manual_id) === true;
}
let MongoSync = class MongoSync {
    initializeSchema() {
        this.schema.initialize();
        validateMongoRelations(this.relationOwner(true), (type)=>this.resolveRelatedOwner(type, true));
    }
    validateGraph() {
        validateMongoRelationGraph(this.relationOwner(), (type)=>this.resolveRelatedOwner(type));
    }
    requireRegistration(allowInitializing = false) {
        var _registration_failure;
        const registration = models.get(this.modelType);
        if (!registration || registration.implementation !== this) throw new Error('Mongo model registration was replaced');
        if (registration.state === 'failed') throw (_registration_failure = registration.failure) !== null && _registration_failure !== void 0 ? _registration_failure : new Error('Mongo model configuration failed');
        if (registration.state === 'initializing' && !allowInitializing) throw new Error('Mongo model configuration is incomplete');
        if (this.modelType.prototype.sync !== registration.sync) throw new Error('Mongo model sync owner was replaced');
        const schemaProvider = Reflect.get(this.modelType, 'schema');
        if (typeof schemaProvider !== 'function' || Reflect.apply(schemaProvider, this.modelType, []) !== this.schema) throw new Error('Mongo model schema owner was replaced');
        return registration;
    }
    relationOwner(allowInitializing = false) {
        this.requireRegistration(allowInitializing);
        return {
            modelType: this.modelType,
            schema: this.schema,
            connection: this.connection,
            codec: this.codec,
            assertAvailable: ()=>{
                this.requireRegistration();
                this.connection.assertAvailable();
            },
            cursor: (query)=>this.cursor(query)
        };
    }
    resolveRelatedOwner(type, allowInitializing = false) {
        const registration = models.get(type);
        if (!registration) throw new Error('Mongo relation requires a registered Mongo model');
        if (!isDeepStrictEqual(registration.options, this.requireRegistration(allowInitializing).options)) throw new Error('Mongo relation connection options conflict');
        return registration.implementation.relationOwner(allowInitializing);
    }
    relationContext() {
        return {
            owner: this.relationOwner(),
            resolve: (type)=>this.resolveRelatedOwner(type)
        };
    }
    cursor(query = {}) {
        return new MongoCursor(query, this.modelType, this.connection, this.codec, ()=>this.relationContext());
    }
    db() {
        return this.databaseControl;
    }
    collection(callback) {
        this.connection.collection(callback);
    }
    dispatch(method, target, optionsValue) {
        if (method === 'sync') return this;
        if (method === 'schema') return this.schema;
        if (method === 'tableName') return this.table;
        if (method === 'isRemote') return false;
        if (method === 'db') return this.db();
        if (method === 'initialize') {
            var _registration_failure;
            const registration = models.get(this.modelType);
            if ((registration === null || registration === void 0 ? void 0 : registration.state) === 'failed') throw (_registration_failure = registration.failure) !== null && _registration_failure !== void 0 ? _registration_failure : new Error('Mongo model configuration failed');
            return;
        }
        if (method === 'cursor') return this.cursor(target);
        if (method === 'destroy') {
            const callback = typeof target === 'function' ? target : optionsValue;
            if (typeof callback !== 'function') throw new Error('destroy requires a callback');
            return operationCallback(()=>this.destroy(typeof target === 'function' ? {} : target), (error, count)=>{
                if (error) callback(error);
                else callback(null, count);
            });
        }
        if (method === 'resetSchema') {
            const callback = typeof target === 'function' ? target : optionsValue;
            if (typeof callback !== 'function') throw new Error(`${method} requires a callback`);
            return typeof target === 'function' ? this.databaseControl.resetSchema(target) : this.databaseControl.resetSchema(target, callback);
        }
        if (method === 'collection') {
            if (typeof target !== 'function') throw new Error('Mongo collection requires a callback');
            return operationCallback(()=>{
                this.validateGraph();
                return this.connection.use(async (collection)=>{
                    this.validateGraph();
                    return collection;
                });
            }, (error, collection)=>target(error, collection));
        }
        if (method === 'closeConnection') {
            if (target === undefined) return this.connection.destroy();
            if (typeof target !== 'function') throw new Error('Mongo closeConnection requires a callback');
            return this.connection.destroy((error)=>target(error));
        }
        if (![
            'create',
            'read',
            'update',
            'patch',
            'delete'
        ].includes(method)) return undefined;
        const options = requireOptions(optionsValue);
        operationCallback(async ()=>{
            if (method === 'read') return this.read(target, options.query);
            if (!(target instanceof Backbone.Model)) throw new Error('Mongo write requires the canonical Backbone model');
            this.validateGraph();
            if (method === 'create') return this.create(target);
            if (method === 'update' || method === 'patch') return this.update(target);
            return this.delete(target);
        }, (error, value)=>{
            if (error) options.error(error);
            else options.success(value);
        });
        return;
    }
    async read(target, query) {
        if (target instanceof Backbone.Collection) return this.cursorResult(this.cursor(query));
        if (!(target instanceof Backbone.Model)) throw new Error('Mongo read requires the canonical Backbone model or collection');
        const json = await this.cursorResult(this.cursor({
            id: target.id,
            $one: true
        }));
        if (json === null) throw new Error('Model not found');
        return json;
    }
    cursorResult(cursor) {
        return new Promise((resolve, reject)=>{
            const callback = (error, value)=>{
                if (error) reject(error);
                else resolve(value);
            };
            cursor.toJSON(callback);
        });
    }
    async create(model) {
        if (this.codec.manual && (model.id === undefined || model.id === null)) throw new Error('Set a manual Mongo id before saving');
        if (model.get('_rev')) throw new Error('New document has a non-empty revision');
        const json = model.toJSON();
        if (!isRecord(json)) throw new Error('Mongo model JSON must be an object');
        const document = this.codec.attributesToNative(json);
        validateMongoForeignKeys(this.relationOwner(), document, (type)=>this.resolveRelatedOwner(type));
        document._rev = 1;
        return this.connection.use(async (collection)=>{
            this.validateGraph();
            validateMongoForeignKeys(this.relationOwner(), document, (type)=>this.resolveRelatedOwner(type));
            try {
                const result = await collection.insertOne(document);
                if (!result.acknowledged) throw new Error('Insert was not acknowledged');
                document._id = result.insertedId;
            } catch (error) {
                throw driverError(error, 'create');
            }
            return this.codec.nativeToAttributes(document);
        });
    }
    async update(model) {
        var _this_pendingUnsets_get;
        const revision = model.get('_rev');
        if (revision === undefined || revision === null || revision === 0) return this.create(model);
        if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1 || revision === Number.MAX_SAFE_INTEGER) throw new Error('Mongo _rev must be a positive safe integer');
        const json = model.toJSON();
        if (!isRecord(json)) throw new Error('Mongo model JSON must be an object');
        const document = this.codec.attributesToNative(json);
        validateMongoForeignKeys(this.relationOwner(), document, (type)=>this.resolveRelatedOwner(type));
        delete document._id;
        document._rev = revision + 1;
        const filter = {
            ...this.codec.findId(model.id),
            _rev: revision
        };
        const pending = (_this_pendingUnsets_get = this.pendingUnsets.get(model)) !== null && _this_pendingUnsets_get !== void 0 ? _this_pendingUnsets_get : new Set();
        const publicUnsets = BackboneORM.Utils.get(model, 'unsets');
        if (publicUnsets !== undefined && publicUnsets !== null) for (const key of stringList(publicUnsets, 'Mongo unsets'))pending.add(key);
        this.pendingUnsets.set(model, pending);
        const unsets = [
            ...pending
        ].filter((key)=>{
            const relation = this.schema.relation(key);
            const serializedForeignKey = (relation === null || relation === void 0 ? void 0 : relation.type) === 'belongsTo' && relation.foreign_key === key && Reflect.getOwnPropertyDescriptor(document, key) !== undefined;
            return !serializedForeignKey && Reflect.getOwnPropertyDescriptor(model.attributes, key) === undefined;
        });
        if (unsets.some((key)=>MONGO_SYSTEM_FIELDS.has(key))) throw new Error('Cannot unset Mongo identity or revision');
        const modifications = {
            $set: document
        };
        if (unsets.length) modifications.$unset = Object.fromEntries(unsets.map((key)=>[
                key,
                ''
            ]));
        return this.connection.use(async (collection)=>{
            this.validateGraph();
            validateMongoForeignKeys(this.relationOwner(), document, (type)=>this.resolveRelatedOwner(type));
            let result;
            try {
                result = await collection.findOneAndUpdate(filter, modifications, {
                    returnDocument: 'after',
                    includeResultMetadata: false,
                    upsert: false
                });
            } catch (error) {
                throw driverError(error, 'update');
            }
            if (!result) throw new Error('Failed to update model. Either the document has been deleted or the revision (_rev) was stale.');
            if (result._rev !== document._rev) throw new Error('Mongo update returned an unexpected revision');
            this.pendingUnsets.delete(model);
            return this.codec.nativeToAttributes(result);
        });
    }
    async destroy(query) {
        this.validateGraph();
        await this.connection.use(async ()=>{
            this.validateGraph();
        });
        const each = Reflect.get(this.modelType, 'each');
        if (typeof each !== 'function') throw new Error('Mongo destroy requires the configured ORM each');
        return new Promise((resolve, reject)=>{
            Reflect.apply(each, this.modelType, [
                {
                    $each: {
                        limit: 1000,
                        json: true
                    },
                    ...query
                },
                (model, next)=>operationCallback(()=>this.delete(model), (error)=>next(error)),
                (error, count)=>{
                    if (error) reject(error);
                    else resolve(count);
                }
            ]);
        });
    }
    async delete(model) {
        const filter = this.codec.findId(model.id);
        await this.connection.use(async (collection)=>{
            this.validateGraph();
            try {
                await collection.deleteMany(filter);
            } catch (error) {
                throw driverError(error, 'delete');
            }
            const modelType = this.modelType;
            if (!hasSchemaControl(modelType)) throw new Error('Mongo deletion requires the configured ORM schema');
            // Native deletion precedes ORM cleanup and cannot be rolled back if cleanup fails.
            await new Promise((resolve, reject)=>{
                BackboneORM.Utils.patchRemove(modelType, model, (error)=>{
                    if (error) reject(error);
                    else resolve();
                });
            });
            if (model instanceof Backbone.Model) this.pendingUnsets.delete(model);
        });
    }
    constructor(modelType, options){
        var _modelType, _model_name;
        this.pendingUnsets = new WeakMap();
        this.modelType = modelType;
        const model = new modelType();
        if (model.idAttribute !== 'id') throw new Error('Mongo first slice requires the public id attribute');
        let url;
        try {
            url = model.url();
        } catch  {
            throw new Error('Missing Mongo URL for model');
        }
        if (typeof url !== 'string') throw new Error('Missing Mongo URL for model');
        this.connection = new MongoConnection(url, options);
        this.table = this.connection.collectionName;
        (_model_name = (_modelType = modelType).model_name) !== null && _model_name !== void 0 ? _model_name : _modelType.model_name = BackboneORM.naming_conventions.modelName(this.table, false);
        this.schema = new BackboneORM.Schema(modelType, {
            id: {
                type: ObjectId
            }
        });
        this.codec = new DocumentCodec(manualID(this.schema));
        const tools = new MongoDatabaseTools(this.connection, this.schema, this.codec.idAttribute, ()=>this.validateGraph());
        this.databaseControl = {
            connection: this.connection,
            dropTable: tools.dropTable,
            ensureIndex: tools.ensureIndex,
            createOrUpdateTable: tools.createOrUpdateTable,
            ensureSchema: tools.ensureSchema,
            resetSchema: tools.resetSchema
        };
    }
};
const MODEL_REGISTRY_KEY = Symbol.for('backbone-mongo.model-registry.v1');
const MODEL_CONFIGURATION_KEY = Symbol.for('backbone-mongo.model-registry.configuration.v1');
function registry() {
    const existing = Reflect.get(globalThis, MODEL_REGISTRY_KEY);
    if (existing !== undefined) {
        if (!(existing instanceof WeakMap)) throw new Error('Invalid shared Mongo model registry');
        return existing;
    }
    const created = new WeakMap();
    Object.defineProperty(globalThis, MODEL_REGISTRY_KEY, {
        value: created
    });
    return created;
}
const models = registry();
const configuration = (_models_MODEL_CONFIGURATION_KEY = models[MODEL_CONFIGURATION_KEY]) !== null && _models_MODEL_CONFIGURATION_KEY !== void 0 ? _models_MODEL_CONFIGURATION_KEY : {
    depth: 0
};
if (models[MODEL_CONFIGURATION_KEY] === undefined) Object.defineProperty(models, MODEL_CONFIGURATION_KEY, {
    value: configuration
});
let defaultOptions = {};
function validateConnectionOptions(options) {
    const forceServerObjectId = Reflect.get(options, 'forceServerObjectId');
    if (forceServerObjectId === true) throw new Error('forceServerObjectId=true is unsupported; Mongo requires client-assigned native IDs');
}
export function configureConnections(options) {
    const resolved = {
        ...defaultOptions,
        ...copyValue(options)
    };
    validateConnectionOptions(resolved);
    defaultOptions = resolved;
}
function isModelConstructor(value) {
    return typeof value === 'function' && (value === Backbone.Model || Reflect.get(value, 'prototype') instanceof Backbone.Model);
}
function isCollectionConstructor(value) {
    return typeof value === 'function' && Reflect.get(value, 'prototype') instanceof Backbone.Collection;
}
function sync(type, options = {}) {
    var _configuration_batch;
    const resolved = {
        ...defaultOptions,
        ...copyValue(options)
    };
    validateConnectionOptions(resolved);
    if (isCollectionConstructor(type)) {
        const previousModel = type.prototype.model;
        if (isModelConstructor(previousModel) && previousModel.prototype.sync !== Backbone.Model.prototype.sync && !models.has(previousModel)) throw new Error('Mongo collection model is already configured with a different sync owner');
        const modelType = BackboneORM.Utils.configureCollectionModelType(type, (model)=>sync(model, resolved));
        return sync(modelType, resolved);
    }
    if (!isModelConstructor(type)) throw new Error('Mongo sync requires the canonical Backbone model constructor');
    const existing = models.get(type);
    if (existing) {
        var _existing_failure;
        if (existing.state === 'failed') throw (_existing_failure = existing.failure) !== null && _existing_failure !== void 0 ? _existing_failure : new Error('Mongo model configuration failed');
        if (existing.state === 'initializing' && configuration.depth === 0) throw new Error('Mongo model configuration is incomplete');
        if (!isDeepStrictEqual(existing.options, resolved)) throw new Error('Mongo model is already configured with a different sync or options');
        const currentSync = type.prototype.sync;
        if (currentSync !== existing.sync) throw new Error('Mongo model is already configured with a different sync or options');
        return currentSync;
    }
    if (type.prototype.sync !== Backbone.Model.prototype.sync) throw new Error('Mongo model is already configured with a different sync owner');
    const implementation = new MongoSync(type, resolved);
    function adapter(method, target, optionsValue) {
        if (method === 'createSync') {
            if (!isModelConstructor(target)) throw new Error('createSync requires a Backbone model constructor');
            return sync(target, resolved);
        }
        return implementation.dispatch(method, target, optionsValue);
    }
    const contract = adapter;
    const registration = {
        implementation,
        options: resolved,
        sync: contract,
        state: 'initializing'
    };
    if (configuration.depth === 0) configuration.batch = [];
    (_configuration_batch = configuration.batch) === null || _configuration_batch === void 0 ? void 0 : _configuration_batch.push(registration);
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
    } catch (error) {
        var _configuration_batch1;
        registration.failure = error instanceof Error ? error : new Error('Mongo schema configuration threw a non-Error value');
        registration.state = 'failed';
        if (configuration.depth === 1) for (const member of (_configuration_batch1 = configuration.batch) !== null && _configuration_batch1 !== void 0 ? _configuration_batch1 : []){
            member.failure = registration.failure;
            member.state = 'failed';
        }
        throw registration.failure;
    } finally{
        configuration.depth -= 1;
        if (configuration.depth === 0) configuration.batch = undefined;
    }
}
const CAPABILITIES = {
    dynamic: true,
    json: true,
    manual_ids: true,
    embed: false,
    self_reference: false,
    unique: false
};
const syncFactory = Object.assign(sync, {
    capabilities () {
        return {
            ...CAPABILITIES
        };
    }
});
export default syncFactory;
