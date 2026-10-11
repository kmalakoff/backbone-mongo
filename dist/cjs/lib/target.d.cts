import type { MongoSyncOptions } from '../types.js';
export interface MongoTarget {
    readonly collection: string;
    readonly database?: string;
    readonly key: string;
    readonly uri: string;
    readonly options: MongoSyncOptions;
}
export declare function resolveMongoTarget(modelURL: string, options: MongoSyncOptions): MongoTarget;
