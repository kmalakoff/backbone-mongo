import type { ResultCallback } from 'backbone-orm';
export declare function operationCallback<T>(operation: () => PromiseLike<T> | T, callback: ResultCallback<T>): void;
export declare function driverError(error: unknown, phase: string): Error;
