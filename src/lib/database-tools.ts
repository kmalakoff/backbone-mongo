import BackboneORM, { type ErrorCallback, type SchemaInstance } from 'backbone-orm';
import type { MongoDatabaseOptions } from '../types.ts';
import type MongoConnection from './connection.ts';
import { driverError, operationCallback } from './settle.ts';

function optionsAndCallback(options: MongoDatabaseOptions | ErrorCallback, callback?: ErrorCallback): [MongoDatabaseOptions, ErrorCallback] {
  const notify = typeof options === 'function' ? options : callback;
  if (typeof notify !== 'function') throw new Error('Mongo database operation requires a callback');
  return [typeof options === 'function' ? {} : options, notify];
}

export default class MongoDatabaseTools {
  private readonly connection: MongoConnection;
  private readonly schema: SchemaInstance;
  private readonly idAttribute: 'id' | '_id';
  private readonly validateGraph: () => void;

  constructor(connection: MongoConnection, schema: SchemaInstance, idAttribute: 'id' | '_id', validateGraph: () => void) {
    this.connection = connection;
    this.schema = schema;
    this.idAttribute = idAttribute;
    this.validateGraph = validateGraph;
    this.dropTable = this.dropTable.bind(this);
    this.ensureIndex = this.ensureIndex.bind(this);
    this.createOrUpdateTable = this.createOrUpdateTable.bind(this);
    this.ensureSchema = this.ensureSchema.bind(this);
    this.resetSchema = this.resetSchema.bind(this);
  }

  ensureSchema(callback: ErrorCallback): void;
  ensureSchema(options: MongoDatabaseOptions, callback: ErrorCallback): void;
  ensureSchema(optionsOrCallback: MongoDatabaseOptions | ErrorCallback, callback?: ErrorCallback): void {
    const [options, notify] = optionsAndCallback(optionsOrCallback, callback);
    this.schemaOperation(false, options, notify);
  }

  resetSchema(callback: ErrorCallback): void;
  resetSchema(options: MongoDatabaseOptions, callback: ErrorCallback): void;
  resetSchema(optionsOrCallback: MongoDatabaseOptions | ErrorCallback, callback?: ErrorCallback): void {
    const [options, notify] = optionsAndCallback(optionsOrCallback, callback);
    this.schemaOperation(true, options, notify);
  }

  private schemaOperation(reset: boolean, options: MongoDatabaseOptions, callback: ErrorCallback): void {
    operationCallback(
      () => {
        if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Mongo schema options must be an object');
        if (options.verbose !== undefined && typeof options.verbose !== 'boolean') throw new Error('Mongo schema verbose must be a boolean');
        return this.connection.scheduleSchemaOperation(async () => {
          if (reset) {
            await new Promise<void>((resolve, reject) => this.dropTable(options, (error) => (error ? reject(error) : resolve())));
          }
          await new Promise<void>((resolve, reject) => this.createOrUpdateTable(options, (error) => (error ? reject(error) : resolve())));
        }, this.validateGraph);
      },
      (error) => callback(error ?? null)
    );
  }

  dropTable(callback: ErrorCallback): void;
  dropTable(options: MongoDatabaseOptions, callback: ErrorCallback): void;
  dropTable(optionsOrCallback: MongoDatabaseOptions | ErrorCallback, callback?: ErrorCallback): void {
    const [options, notify] = optionsAndCallback(optionsOrCallback, callback);
    operationCallback(
      () => {
        this.validateGraph();
        return this.connection.use(async (collection) => {
          this.validateGraph();
          try {
            await collection.deleteMany({});
          } catch (error: unknown) {
            const safe = driverError(error, 'dropTable');
            if (options.verbose) console.log(`Failed to reset collection: ${collection.collectionName}. Error: ${safe.message}`);
            throw safe;
          }
          if (options.verbose) console.log(`Reset collection: ${collection.collectionName}`);
        });
      },
      (error) => notify(error ?? null)
    );
  }

  ensureIndex(field: string, callback: ErrorCallback): void;
  ensureIndex(field: string, options: MongoDatabaseOptions, callback: ErrorCallback): void;
  ensureIndex(field: string, optionsOrCallback: MongoDatabaseOptions | ErrorCallback, callback?: ErrorCallback): void {
    const [options, notify] = optionsAndCallback(optionsOrCallback, callback);
    operationCallback(
      () => {
        this.validateGraph();
        return this.connection.use(async (collection) => {
          this.validateGraph();
          try {
            await collection.createIndex({ [field]: 1 }, field === '_id' ? {} : { background: true });
          } catch (error: unknown) {
            throw driverError(error, 'ensureIndex');
          }
          if (options.verbose) console.log(`MongoBackbone: Successfully indexed '${field}' on ${collection.collectionName}`);
        });
      },
      (error) => (error ? notify(error) : notify())
    );
  }

  createOrUpdateTable(options: MongoDatabaseOptions, callback: ErrorCallback): void {
    if (typeof callback !== 'function') throw new Error('Mongo createOrUpdateTable requires a callback');
    operationCallback(
      async () => {
        this.validateGraph();
        await this.connection.use(async (collection) => {
          this.validateGraph();
          if (options.verbose) console.log(`Ensuring table: ${collection.collectionName} with fields: '${Object.keys(this.schema.fields).join(', ')}' and relations: '${Object.keys(this.schema.relations).join(', ')}'`);
        });
        this.validateGraph();
        return new Promise<void>((resolve, reject) => {
          const queue = new BackboneORM.Queue();
          queue.defer((next) => this.ensureIndex(this.idAttribute, options, next));
          for (const [key, field] of Object.entries(this.schema.fields)) {
            if (field.indexed) queue.defer((next) => this.ensureIndex(key, options, next));
          }
          for (const relation of Object.values(this.schema.relations)) {
            if (relation.type === 'belongsTo' && !relation.isVirtual() && !relation.isEmbedded()) queue.defer((next) => this.ensureIndex(relation.foreign_key, options, next));
          }
          queue.await((error) => (error ? reject(error) : resolve()));
        });
      },
      (error) => callback(error ?? null)
    );
  }
}
