import { type Filter, ObjectId } from 'mongodb';
import type { MongoDocument } from '../types.js';
export default class DocumentCodec {
    readonly idAttribute: 'id' | '_id';
    readonly manual: boolean;
    constructor(manual: boolean);
    id(value: unknown): ObjectId | string | number;
    findId(value: unknown): Filter<MongoDocument>;
    attributesToNative(attributes: Record<string, unknown>): MongoDocument;
    nativeToAttributes(native: MongoDocument): Record<string, unknown>;
}
