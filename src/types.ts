import type Backbone from 'backbone';
import type { CollectionConstructor, ErrorCallback, ModelConstructor, ModelSync, ResultCallback } from 'backbone-orm';
import type { Collection, MongoClientOptions, ObjectId } from 'mongodb';

export type MongoDocument = Record<string, unknown> & { _id?: ObjectId; _rev?: number; id?: number | string };

export type MongoSyncOptions = Omit<MongoClientOptions, 'forceServerObjectId'> & { forceServerObjectId?: false };

export interface MongoConnectionControl {
  /** Opaque ConnectionPool identity; no credentials or raw URI. */
  readonly url: string;
  collection(callback: ResultCallback<Collection<MongoDocument>>): void;
  destroy(): Promise<void>;
  destroy(callback: ErrorCallback): void;
}

export interface MongoDatabaseOptions {
  verbose?: boolean;
}

export interface MongoDatabaseControl {
  readonly connection: MongoConnectionControl;
  dropTable(callback: ErrorCallback): void;
  dropTable(options: MongoDatabaseOptions, callback: ErrorCallback): void;
  ensureIndex(field: string, callback: ErrorCallback): void;
  ensureIndex(field: string, options: MongoDatabaseOptions, callback: ErrorCallback): void;
  createOrUpdateTable(options: MongoDatabaseOptions, callback: ErrorCallback): void;
  ensureSchema(callback: ErrorCallback): void;
  ensureSchema(options: MongoDatabaseOptions, callback: ErrorCallback): void;
  resetSchema(callback: ErrorCallback): void;
  resetSchema(options: MongoDatabaseOptions, callback: ErrorCallback): void;
}

export interface MongoCapabilities {
  dynamic: true;
  json: true;
  manual_ids: true;
  embed: false;
  self_reference: false;
  unique: false;
}

export interface MongoSyncFactory {
  <M extends Backbone.Model>(modelType: ModelConstructor<M>, options?: MongoSyncOptions): ModelSync;
  <C extends Backbone.Collection>(collectionType: CollectionConstructor<C>, options?: MongoSyncOptions): Backbone.Collection['sync'];
  capabilities(url?: string): MongoCapabilities;
}

export interface MongoConfigureOptions {
  connection_options?: MongoSyncOptions;
  [key: string]: unknown;
}
