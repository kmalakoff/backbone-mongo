import type { MongoSyncFactory, MongoSyncOptions } from './types.js';
export declare function configureConnections(options: MongoSyncOptions): void;
declare const syncFactory: MongoSyncFactory;
export default syncFactory;
