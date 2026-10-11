import type { Filter } from 'mongodb';
import type { MongoDocument } from '../types.js';
import type DocumentCodec from './document.js';
export declare const LOGICAL_OPERATORS: Set<string>;
export declare function compileFilter(find: Record<string, unknown>, cursor: Record<string, unknown>, codec: DocumentCodec, fieldPolicy?: (field: string) => void): Filter<MongoDocument>;
export declare function compileSort(value: unknown, codec: DocumentCodec, fieldPolicy?: (field: string) => void): Record<string, 1 | -1>;
