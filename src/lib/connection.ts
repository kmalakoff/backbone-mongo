import { isDeepStrictEqual } from 'node:util';
import BackboneORM, { type ConnectionDisposer, type ConnectionPoolInstance, type ErrorCallback, type QueueInstance, type ResultCallback } from 'backbone-orm';
import { type Collection, MongoClient } from 'mongodb';
import Queue from 'queue-cb';
import type { MongoConnectionControl, MongoDocument, MongoSyncOptions } from '../types.ts';
import { driverError, operationCallback } from './settle.ts';
import { type MongoTarget, resolveMongoTarget } from './target.ts';
import { isRecord } from './values.ts';

interface ClientState {
  readonly client: MongoClient;
  readonly key: string;
  readonly options: MongoSyncOptions;
  readonly owned: boolean;
  readonly pool: ConnectionPoolInstance;
  readonly leases: Set<MongoConnection>;
  readonly operations: Set<Promise<unknown>>;
  schemaQueue?: QueueInstance;
  ready?: Promise<void>;
  closing: boolean;
  connectionFailed: boolean;
  closePromise?: Promise<void>;
}

interface ClientOwnership {
  readonly states: WeakMap<MongoClient, ClientState>;
  readonly disposer: ConnectionDisposer<MongoClient>;
}

const OWNERSHIP_KEY = Symbol.for('backbone-mongo.client-ownership.v1');

function drainOperations(state: ClientState): Promise<void> {
  return new Promise((resolve) => {
    const queue = new Queue(1);
    for (const operation of state.operations) {
      // Each operation delivers its error to its caller; disposal only awaits settlement.
      queue.defer((done) => {
        void operation.then(
          () => done(),
          () => done()
        );
      });
    }
    queue.await(() => resolve());
  });
}

function closeClient(state: ClientState): Promise<void> {
  if (state.closePromise) return state.closePromise;
  state.closing = true;
  state.closePromise = (async () => {
    await drainOperations(state);
    try {
      await state.client.close();
    } catch (error: unknown) {
      throw driverError(error, 'client close');
    }
  })();
  return state.closePromise;
}

function disposeOriginalClient(state: ClientState): Promise<void> {
  if (state.pool.get(state.key) === state.client) return state.pool.dispose(state.key);
  return closeClient(state);
}

function isOwnership(value: unknown): value is ClientOwnership {
  return typeof value === 'object' && value !== null && Reflect.get(value, 'states') instanceof WeakMap && typeof Reflect.get(value, 'disposer') === 'function';
}

function sharedOwnership(): ClientOwnership {
  const existing: unknown = Reflect.get(globalThis, OWNERSHIP_KEY);
  if (existing !== undefined) {
    if (!isOwnership(existing)) throw new Error('Invalid shared Mongo client ownership state');
    return existing;
  }
  const states = new WeakMap<MongoClient, ClientState>();
  const ownership: ClientOwnership = {
    states,
    disposer(client, callback): void {
      const state = states.get(client);
      if (!state?.owned) {
        callback(new Error('Mongo disposer received an unowned client'));
        return;
      }
      operationCallback(
        () => closeClient(state),
        (error) => callback(error)
      );
    },
  };
  Object.defineProperty(globalThis, OWNERSHIP_KEY, { value: ownership });
  return ownership;
}

const ownership = sharedOwnership();

function clientConfiguration(client: MongoClient): Record<string, unknown> {
  // Driver 7.7 adds per-instance Promises and a logger writer closure, not configuration.
  const configuration = Object.fromEntries(Object.entries(client.options).filter(([key]) => !['metadata', 'runtime', 'mongoLoggerOptions'].includes(key)));
  const logger: unknown = Reflect.get(client.options, 'mongoLoggerOptions');
  if (isRecord(logger)) configuration.mongoLoggerOptions = Object.fromEntries(Object.entries(logger).filter(([key]) => key !== 'logDestination'));
  return configuration;
}

function acquireClient(target: MongoTarget, connection: MongoConnection): ClientState {
  const pool = BackboneORM.ConnectionPool;
  const pooled: unknown = pool.get(target.key);
  if (pooled !== undefined && !(pooled instanceof MongoClient)) throw new Error('ConnectionPool entry is not a MongoClient');
  let state = pooled ? ownership.states.get(pooled) : undefined;
  if (state) {
    if (state.closing) throw new Error('Mongo client is closed');
    if (state.key !== target.key || !isDeepStrictEqual(state.options, target.options)) throw new Error('Mongo client options conflict with an existing pooled client');
  } else {
    let candidate: MongoClient;
    try {
      candidate = new MongoClient(target.uri, target.options);
    } catch {
      throw new Error('Invalid Mongo client options or connection URI');
    }
    if (candidate.options.forceServerObjectId) throw new Error('forceServerObjectId=true is unsupported; Mongo requires client-assigned native IDs');
    // A foreign client's actual driver-resolved options must agree before it is borrowed.
    if (pooled && !isDeepStrictEqual(clientConfiguration(pooled), clientConfiguration(candidate))) throw new Error('Borrowed Mongo client options do not match the requested connection');
    state = {
      client: pooled ?? candidate,
      key: target.key,
      options: target.options,
      owned: pooled === undefined,
      pool,
      leases: new Set(),
      operations: new Set(),
      closing: false,
      connectionFailed: false,
    };
    ownership.states.set(state.client, state);
    if (state.owned) pool.setOwned(target.key, state.client, ownership.disposer);
  }
  state.leases.add(connection);
  return state;
}

export default class MongoConnection implements MongoConnectionControl {
  readonly url: string;
  readonly collectionName: string;
  private readonly target: MongoTarget;
  private state?: ClientState;
  private released = false;
  private releasePromise?: Promise<void>;

  constructor(modelURL: string, options: MongoSyncOptions) {
    this.target = resolveMongoTarget(modelURL, options);
    this.url = this.target.key;
    this.collectionName = this.target.collection;
  }

  assertAvailable(): void {
    if (this.released) throw new Error('Mongo connection is closed');
    const pooled = BackboneORM.ConnectionPool.get(this.target.key);
    if (pooled !== undefined && !(pooled instanceof MongoClient)) throw new Error('ConnectionPool entry is not a MongoClient');
    const state = this.state ?? (pooled instanceof MongoClient ? ownership.states.get(pooled) : undefined);
    if (state?.closing) throw new Error('Mongo client is closed');
    if (this.state && this.state.pool.get(this.state.key) !== this.state.client) throw new Error('Mongo pooled client was replaced');
  }

  private clientState(): ClientState {
    this.assertAvailable();
    const state = this.state ?? acquireClient(this.target, this);
    this.state = state;
    if (state.closing) throw new Error('Mongo client is closed');
    if (state.pool.get(state.key) !== state.client) throw new Error('Mongo pooled client was replaced');
    return state;
  }

  scheduleSchemaOperation(operation: () => Promise<void>, verify: () => void): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      verify();
      const state = this.clientState();
      state.schemaQueue ??= new BackboneORM.Queue(1);
      state.schemaQueue.defer((done) => {
        const complete = (failed: boolean, error?: unknown): void => {
          // Only native requests are tracked; an outer job must not enter the disposal drain.
          void drainOperations(state).then(
            () => {
              done(null);
              if (failed) reject(error);
              else resolve();
            },
            (cleanup: unknown) => {
              done(null);
              reject(failed ? new AggregateError([error, cleanup], 'Mongo schema operation/native drain failed') : cleanup);
            }
          );
        };
        void Promise.resolve()
          .then(() => {
            this.assertAvailable();
            verify();
            return operation();
          })
          .then(
            () => complete(false),
            (error: unknown) => complete(true, error)
          );
      });
    });
  }

  async use<T>(operation: (collection: Collection<MongoDocument>) => Promise<T>): Promise<T> {
    const state = this.clientState();
    const pending = Promise.resolve().then(async () => {
      if (state.closing) throw new Error('Mongo client is closed');
      state.ready ??= state.client.connect().then(
        () => undefined,
        (error: unknown) => {
          state.connectionFailed = true;
          throw driverError(error, 'connection');
        }
      );
      await state.ready;
      if (this.released || state.closing) throw new Error('Mongo connection is closed');
      if (state.pool.get(state.key) !== state.client) throw new Error('Mongo pooled client was replaced');
      const collection = state.client.db(this.target.database).collection<MongoDocument>(this.target.collection);
      return operation(collection);
    });
    state.operations.add(pending);
    try {
      return await pending;
    } catch (error: unknown) {
      if (state.connectionFailed && state.owned) {
        // The failed pending Promise is already settled, so disposal can drain all callers.
        try {
          await disposeOriginalClient(state);
        } catch (cleanup: unknown) {
          throw new AggregateError([error, cleanup], 'Mongo connection failed and original client cleanup failed');
        }
      }
      throw error;
    } finally {
      state.operations.delete(pending);
    }
  }

  collection(callback: ResultCallback<Collection<MongoDocument>>): void {
    operationCallback(() => this.use(async (collection) => collection), callback);
  }

  destroy(): Promise<void>;
  destroy(callback: ErrorCallback): void;
  destroy(callback?: ErrorCallback): Promise<void> | void {
    this.released = true;
    this.releasePromise ??= this.release();
    if (!callback) return this.releasePromise;
    operationCallback(
      () => this.releasePromise,
      (error) => callback(error)
    );
  }

  private async release(): Promise<void> {
    const state = this.state;
    if (!state) return;
    state.leases.delete(this);
    if (!state.owned || state.leases.size !== 0) return;
    await disposeOriginalClient(state);
  }
}
