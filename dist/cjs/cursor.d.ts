import BackboneORM, { type CursorCallback, type CursorModelConstructor } from 'backbone-orm';
import type MongoConnection from './lib/connection.js';
import type DocumentCodec from './lib/document.js';
import { type MongoRelationContext } from './lib/relations.js';
export default class MongoCursor extends BackboneORM.Cursor {
    private readonly connection;
    private readonly codec;
    private readonly relationContext;
    constructor(query: unknown, modelType: CursorModelConstructor, connection: MongoConnection, codec: DocumentCodec, relationContext: () => MongoRelationContext);
    queryToJSON(callback: CursorCallback): void;
    private query;
}
