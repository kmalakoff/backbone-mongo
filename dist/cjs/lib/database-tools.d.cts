import { type ErrorCallback, type SchemaInstance } from 'backbone-orm';
import type { MongoDatabaseOptions } from '../types.js';
import type MongoConnection from './connection.js';
export default class MongoDatabaseTools {
    private readonly connection;
    private readonly schema;
    private readonly idAttribute;
    private readonly validateGraph;
    constructor(connection: MongoConnection, schema: SchemaInstance, idAttribute: 'id' | '_id', validateGraph: () => void);
    ensureSchema(callback: ErrorCallback): void;
    ensureSchema(options: MongoDatabaseOptions, callback: ErrorCallback): void;
    resetSchema(callback: ErrorCallback): void;
    resetSchema(options: MongoDatabaseOptions, callback: ErrorCallback): void;
    private schemaOperation;
    dropTable(callback: ErrorCallback): void;
    dropTable(options: MongoDatabaseOptions, callback: ErrorCallback): void;
    ensureIndex(field: string, callback: ErrorCallback): void;
    ensureIndex(field: string, options: MongoDatabaseOptions, callback: ErrorCallback): void;
    createOrUpdateTable(options: MongoDatabaseOptions, callback: ErrorCallback): void;
}
