import BackboneORM, { type CursorCallback, type CursorModelConstructor } from 'backbone-orm';
import type { FindOptions } from 'mongodb';
import type MongoConnection from './lib/connection.ts';
import type DocumentCodec from './lib/document.ts';
import { compileFilter, compileSort, LOGICAL_OPERATORS } from './lib/query.ts';
import { fetchMongoIncludes, type MongoRelationContext, mongoIncludes, rejectMongoRelationPredicate } from './lib/relations.ts';
import { driverError, operationCallback } from './lib/settle.ts';
import { copyValue, nonnegativeInteger, stringList } from './lib/values.ts';

const CURSOR_KEYS = new Set(['$count', '$exists', '$ids', '$include', '$limit', '$offset', '$one', '$page', '$select', '$sort', '$values', '$whitelist', '$zero']);

export default class MongoCursor extends BackboneORM.Cursor {
  private readonly connection: MongoConnection;
  private readonly codec: DocumentCodec;
  private readonly relationContext: () => MongoRelationContext;

  constructor(query: unknown, modelType: CursorModelConstructor, connection: MongoConnection, codec: DocumentCodec, relationContext: () => MongoRelationContext) {
    // ORM's scalar parser treats 0 as no query; make the adapter's manual-id lookup explicit.
    super(query === 0 ? { id: 0, $one: true } : copyValue(query), { model_type: modelType });
    this.connection = connection;
    this.codec = codec;
    this.relationContext = relationContext;
  }

  queryToJSON(callback: CursorCallback): void {
    operationCallback(
      () => this.query(),
      (error, value) => callback(error, value)
    );
  }

  private async query(): Promise<unknown> {
    for (const key of Object.keys(this._cursor)) if (!CURSOR_KEYS.has(key) && !LOGICAL_OPERATORS.has(key)) throw new Error(`Mongo cursor control is not implemented: ${key}`);
    const context = this.relationContext();
    const includes = mongoIncludes(context.owner, this._cursor.$include, context.resolve);
    if (this.hasCursorQuery('$zero')) return this.hasCursorQuery('$one') ? null : [];
    const fieldPolicy = (field: string): void => rejectMongoRelationPredicate(context.owner.schema, field);
    const filter = compileFilter(this._find, this._cursor, this.codec, fieldPolicy);
    const findOptions: FindOptions = {};
    if (this._cursor.$offset !== undefined) findOptions.skip = nonnegativeInteger(this._cursor.$offset, '$offset');
    if (this._cursor.$limit !== undefined) findOptions.limit = nonnegativeInteger(this._cursor.$limit, '$limit');
    if (this.hasCursorQuery('$one')) findOptions.limit = 1;
    if (this._cursor.$sort !== undefined) findOptions.sort = compileSort(this._cursor.$sort, this.codec, fieldPolicy);
    const requested = this._cursor.$values ?? this._cursor.$select ?? this._cursor.$whitelist;
    if (requested !== undefined) {
      const whitelist = this._cursor.$whitelist === undefined ? undefined : stringList(this._cursor.$whitelist, '$whitelist');
      const fields = stringList(requested, 'Mongo projection').filter((field) => !whitelist || whitelist.includes(field));
      for (const field of fields) if (field.includes('.')) fieldPolicy(field);
      const nativeFields = fields.filter((field) => !includes.some(({ relation }) => relation.key === field));
      const privateForeignKeys = includes.filter(({ relation }) => relation.type === 'belongsTo').map(({ relation }) => relation.foreign_key);
      // Keep the native identity long enough to decode it, then let ORM select public fields.
      findOptions.projection = { _id: 1, ...Object.fromEntries([...nativeFields, ...privateForeignKeys].map((field) => [field === 'id' ? this.codec.idAttribute : field, 1])) };
    }
    return this.connection.use(async (collection) => {
      const currentContext = this.relationContext();
      const currentIncludes = mongoIncludes(currentContext.owner, this._cursor.$include, currentContext.resolve);
      let rows: Record<string, unknown>[] = [];
      let totalRows = 0;
      try {
        if (this.hasCursorQuery('$count')) return await collection.countDocuments(filter);
        if (this.hasCursorQuery('$exists')) return (await collection.findOne(filter, { projection: { _id: 1 } })) !== null;
        // Mongo limit(0) means unlimited; ORM's explicit zero limit means an empty result.
        if (findOptions.limit !== 0) {
          const cursor = collection.find(filter, findOptions);
          try {
            rows = (await cursor.toArray()).map((document) => this.codec.nativeToAttributes(document));
          } finally {
            await cursor.close();
          }
        }
        if (this.hasCursorQuery('$page')) totalRows = await collection.countDocuments(filter);
      } catch (error: unknown) {
        throw driverError(error, 'query');
      }
      await fetchMongoIncludes(rows, currentIncludes);
      if (this.hasCursorQuery('$page')) return { offset: findOptions.skip ?? 0, total_rows: totalRows, rows: this.selectResults(rows) };
      return this.selectResults(rows);
    });
  }
}
