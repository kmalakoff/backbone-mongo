import { isDeepStrictEqual } from 'node:util';
import BackboneORM from 'backbone-orm';
import { MongoClient } from 'mongodb';
import Queue from 'queue-cb';
import { driverError, operationCallback } from './settle.js';
import { resolveMongoTarget } from './target.js';
import { isRecord } from './values.js';
const OWNERSHIP_KEY = Symbol.for('backbone-mongo.client-ownership.v1');
function drainOperations(state) {
    return new Promise((resolve)=>{
        const queue = new Queue(1);
        for (const operation of state.operations){
            // Each operation delivers its error to its caller; disposal only awaits settlement.
            queue.defer((done)=>{
                void operation.then(()=>done(), ()=>done());
            });
        }
        queue.await(()=>resolve());
    });
}
function closeClient(state) {
    if (state.closePromise) return state.closePromise;
    state.closing = true;
    state.closePromise = (async ()=>{
        await drainOperations(state);
        try {
            await state.client.close();
        } catch (error) {
            throw driverError(error, 'client close');
        }
    })();
    return state.closePromise;
}
function disposeOriginalClient(state) {
    if (state.pool.get(state.key) === state.client) return state.pool.dispose(state.key);
    return closeClient(state);
}
function isOwnership(value) {
    return typeof value === 'object' && value !== null && Reflect.get(value, 'states') instanceof WeakMap && typeof Reflect.get(value, 'disposer') === 'function';
}
function sharedOwnership() {
    const existing = Reflect.get(globalThis, OWNERSHIP_KEY);
    if (existing !== undefined) {
        if (!isOwnership(existing)) throw new Error('Invalid shared Mongo client ownership state');
        return existing;
    }
    const states = new WeakMap();
    const ownership = {
        states,
        disposer (client, callback) {
            const state = states.get(client);
            if (!(state === null || state === void 0 ? void 0 : state.owned)) {
                callback(new Error('Mongo disposer received an unowned client'));
                return;
            }
            operationCallback(()=>closeClient(state), (error)=>callback(error));
        }
    };
    Object.defineProperty(globalThis, OWNERSHIP_KEY, {
        value: ownership
    });
    return ownership;
}
const ownership = sharedOwnership();
function clientConfiguration(client) {
    // Driver 7.7 adds per-instance Promises and a logger writer closure, not configuration.
    const configuration = Object.fromEntries(Object.entries(client.options).filter(([key])=>![
            'metadata',
            'runtime',
            'mongoLoggerOptions'
        ].includes(key)));
    const logger = Reflect.get(client.options, 'mongoLoggerOptions');
    if (isRecord(logger)) configuration.mongoLoggerOptions = Object.fromEntries(Object.entries(logger).filter(([key])=>key !== 'logDestination'));
    return configuration;
}
function acquireClient(target, connection) {
    const pool = BackboneORM.ConnectionPool;
    const pooled = pool.get(target.key);
    if (pooled !== undefined && !(pooled instanceof MongoClient)) throw new Error('ConnectionPool entry is not a MongoClient');
    let state = pooled ? ownership.states.get(pooled) : undefined;
    if (state) {
        if (state.closing) throw new Error('Mongo client is closed');
        if (state.key !== target.key || !isDeepStrictEqual(state.options, target.options)) throw new Error('Mongo client options conflict with an existing pooled client');
    } else {
        let candidate;
        try {
            candidate = new MongoClient(target.uri, target.options);
        } catch  {
            throw new Error('Invalid Mongo client options or connection URI');
        }
        if (candidate.options.forceServerObjectId) throw new Error('forceServerObjectId=true is unsupported; Mongo requires client-assigned native IDs');
        // A foreign client's actual driver-resolved options must agree before it is borrowed.
        if (pooled && !isDeepStrictEqual(clientConfiguration(pooled), clientConfiguration(candidate))) throw new Error('Borrowed Mongo client options do not match the requested connection');
        state = {
            client: pooled !== null && pooled !== void 0 ? pooled : candidate,
            key: target.key,
            options: target.options,
            owned: pooled === undefined,
            pool,
            leases: new Set(),
            operations: new Set(),
            closing: false,
            connectionFailed: false
        };
        ownership.states.set(state.client, state);
        if (state.owned) pool.setOwned(target.key, state.client, ownership.disposer);
    }
    state.leases.add(connection);
    return state;
}
let MongoConnection = class MongoConnection {
    assertAvailable() {
        var _this_state;
        if (this.released) throw new Error('Mongo connection is closed');
        const pooled = BackboneORM.ConnectionPool.get(this.target.key);
        if (pooled !== undefined && !(pooled instanceof MongoClient)) throw new Error('ConnectionPool entry is not a MongoClient');
        const state = (_this_state = this.state) !== null && _this_state !== void 0 ? _this_state : pooled instanceof MongoClient ? ownership.states.get(pooled) : undefined;
        if (state === null || state === void 0 ? void 0 : state.closing) throw new Error('Mongo client is closed');
        if (this.state && this.state.pool.get(this.state.key) !== this.state.client) throw new Error('Mongo pooled client was replaced');
    }
    clientState() {
        var _this_state;
        this.assertAvailable();
        const state = (_this_state = this.state) !== null && _this_state !== void 0 ? _this_state : acquireClient(this.target, this);
        this.state = state;
        if (state.closing) throw new Error('Mongo client is closed');
        if (state.pool.get(state.key) !== state.client) throw new Error('Mongo pooled client was replaced');
        return state;
    }
    scheduleSchemaOperation(operation, verify) {
        return new Promise((resolve, reject)=>{
            var _state, _schemaQueue;
            verify();
            const state = this.clientState();
            (_schemaQueue = (_state = state).schemaQueue) !== null && _schemaQueue !== void 0 ? _schemaQueue : _state.schemaQueue = new BackboneORM.Queue(1);
            state.schemaQueue.defer((done)=>{
                const complete = (failed, error)=>{
                    // Only native requests are tracked; an outer job must not enter the disposal drain.
                    void drainOperations(state).then(()=>{
                        done(null);
                        if (failed) reject(error);
                        else resolve();
                    }, (cleanup)=>{
                        done(null);
                        reject(failed ? new AggregateError([
                            error,
                            cleanup
                        ], 'Mongo schema operation/native drain failed') : cleanup);
                    });
                };
                void Promise.resolve().then(()=>{
                    this.assertAvailable();
                    verify();
                    return operation();
                }).then(()=>complete(false), (error)=>complete(true, error));
            });
        });
    }
    async use(operation) {
        const state = this.clientState();
        const pending = Promise.resolve().then(async ()=>{
            var _state, _ready;
            if (state.closing) throw new Error('Mongo client is closed');
            (_ready = (_state = state).ready) !== null && _ready !== void 0 ? _ready : _state.ready = state.client.connect().then(()=>undefined, (error)=>{
                state.connectionFailed = true;
                throw driverError(error, 'connection');
            });
            await state.ready;
            if (this.released || state.closing) throw new Error('Mongo connection is closed');
            if (state.pool.get(state.key) !== state.client) throw new Error('Mongo pooled client was replaced');
            const collection = state.client.db(this.target.database).collection(this.target.collection);
            return operation(collection);
        });
        state.operations.add(pending);
        try {
            return await pending;
        } catch (error) {
            if (state.connectionFailed && state.owned) {
                // The failed pending Promise is already settled, so disposal can drain all callers.
                try {
                    await disposeOriginalClient(state);
                } catch (cleanup) {
                    throw new AggregateError([
                        error,
                        cleanup
                    ], 'Mongo connection failed and original client cleanup failed');
                }
            }
            throw error;
        } finally{
            state.operations.delete(pending);
        }
    }
    collection(callback) {
        operationCallback(()=>this.use(async (collection)=>collection), callback);
    }
    destroy(callback) {
        var _this_releasePromise;
        this.released = true;
        (_this_releasePromise = this.releasePromise) !== null && _this_releasePromise !== void 0 ? _this_releasePromise : this.releasePromise = this.release();
        if (!callback) return this.releasePromise;
        operationCallback(()=>this.releasePromise, (error)=>callback(error));
    }
    async release() {
        const state = this.state;
        if (!state) return;
        state.leases.delete(this);
        if (!state.owned || state.leases.size !== 0) return;
        await disposeOriginalClient(state);
    }
    constructor(modelURL, options){
        this.released = false;
        this.target = resolveMongoTarget(modelURL, options);
        this.url = this.target.key;
        this.collectionName = this.target.collection;
    }
};
export { MongoConnection as default };
