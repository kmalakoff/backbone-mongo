import type Backbone from 'backbone';
import type { CursorInstance, ModelConstructor, Relation, SchemaInstance } from 'backbone-orm';
import type MongoConnection from './connection.js';
import type DocumentCodec from './document.js';
export interface MongoRelationOwner {
    readonly modelType: ModelConstructor<Backbone.Model>;
    readonly schema: SchemaInstance;
    readonly connection: MongoConnection;
    readonly codec: DocumentCodec;
    assertAvailable(): void;
    cursor(query: unknown): CursorInstance;
}
export type ResolveRelatedOwner = (type: ModelConstructor<Backbone.Model>) => MongoRelationOwner;
export declare const MONGO_SYSTEM_FIELDS: ReadonlySet<string>;
export interface MongoRelationContext {
    readonly owner: MongoRelationOwner;
    readonly resolve: ResolveRelatedOwner;
}
export declare function requireMongoRelation(owner: MongoRelationOwner, key: string, resolve: ResolveRelatedOwner): {
    relation: Relation;
    related: MongoRelationOwner;
};
export declare function validateMongoRelations(owner: MongoRelationOwner, resolve: ResolveRelatedOwner): void;
export declare function validateMongoRelationGraph(owner: MongoRelationOwner, resolve: ResolveRelatedOwner): void;
export declare function validateMongoForeignKeys(owner: MongoRelationOwner, attributes: Record<string, unknown>, resolve: ResolveRelatedOwner): void;
export declare function mongoIncludes(owner: MongoRelationOwner, value: unknown, resolve: ResolveRelatedOwner): Array<{
    relation: Relation;
    related: MongoRelationOwner;
}>;
export declare function fetchMongoIncludes(rows: Record<string, unknown>[], includes: ReturnType<typeof mongoIncludes>): Promise<void>;
export declare function rejectMongoRelationPredicate(schema: SchemaInstance, field: string): void;
