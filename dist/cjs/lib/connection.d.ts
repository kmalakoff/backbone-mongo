import { type ErrorCallback, type ResultCallback } from 'backbone-orm';
import { type Collection } from 'mongodb';
import type { MongoConnectionControl, MongoDocument, MongoSyncOptions } from '../types.js';
export default class MongoConnection implements MongoConnectionControl {
    readonly url: string;
    readonly collectionName: string;
    private readonly target;
    private state?;
    private released;
    private releasePromise?;
    constructor(modelURL: string, options: MongoSyncOptions);
    assertAvailable(): void;
    private clientState;
    scheduleSchemaOperation(operation: () => Promise<void>, verify: () => void): Promise<void>;
    use<T>(operation: (collection: Collection<MongoDocument>) => Promise<T>): Promise<T>;
    collection(callback: ResultCallback<Collection<MongoDocument>>): void;
    destroy(): Promise<void>;
    destroy(callback: ErrorCallback): void;
    private release;
}
