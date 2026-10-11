import { ObjectId } from 'mongodb';
import { isRecord, stringList } from './values.js';
export const MONGO_SYSTEM_FIELDS = new Set([
    'id',
    '_id',
    '_rev'
]);
export function requireMongoRelation(owner, key, resolve) {
    const relation = owner.schema.relations[key];
    if (!relation || relation.key !== key) throw new Error(`Mongo include requires a declared relation key: ${key}`);
    if (!key || key.includes('.') || key.includes('\0') || key.startsWith('$')) throw new Error('Mongo requires an ordinary relation key');
    if (relation.type !== 'belongsTo' && relation.type !== 'hasMany' && relation.type !== 'hasOne') throw new Error(`Mongo ${relation.type} relations are not implemented: ${key}`);
    if (relation.isEmbedded() || relation.isVirtual() || relation.join_table) throw new Error(`Mongo embedded, virtual or join-table relation is not implemented: ${key}`);
    if (relation.model_type !== owner.modelType) throw new Error(`Mongo relation has an unsupported model owner: ${key}`);
    const related = resolve(relation.reverse_model_type);
    if (related.modelType !== relation.reverse_model_type || related.connection.url !== owner.connection.url) throw new Error(`Mongo relation requires the same registered connection: ${key}`);
    if (owner.codec.manual || related.codec.manual) throw new Error(`Mongo manual-ID relations require a separate ORM compatibility decision: ${key}`);
    if (relation.type === 'belongsTo' && (!relation.foreign_key || MONGO_SYSTEM_FIELDS.has(relation.foreign_key) || relation.foreign_key.includes('.') || relation.foreign_key.includes('\0') || relation.foreign_key.startsWith('$'))) throw new Error('Mongo requires an ordinary non-system foreign key field');
    const reverse = relation.reverse_relation;
    if (relation.reverse_model_type === owner.modelType && !(relation.type === 'belongsTo' && (reverse === null || reverse === void 0 ? void 0 : reverse.type) === 'hasMany' || relation.type === 'hasMany' && (reverse === null || reverse === void 0 ? void 0 : reverse.type) === 'belongsTo')) throw new Error(`Mongo relation has an unsupported model owner: ${key}`);
    if (relation.type !== 'belongsTo' && (reverse === null || reverse === void 0 ? void 0 : reverse.type) !== 'belongsTo') throw new Error(`Mongo ${relation.type} requires a belongsTo inverse: ${key}`);
    if (reverse && (reverse.isEmbedded() || reverse.isVirtual() || reverse.join_table || reverse.model_type !== related.modelType || reverse.reverse_model_type !== owner.modelType)) throw new Error(`Mongo relation has an unsupported inverse: ${key}`);
    if (reverse && (relation.type === 'belongsTo' ? reverse.type !== 'hasMany' && reverse.type !== 'hasOne' : reverse.type !== 'belongsTo')) throw new Error(`Mongo relation has an unsupported inverse type: ${key}`);
    if (reverse && related.schema.relations[reverse.key] !== reverse) throw new Error(`Mongo relation lost its registered inverse: ${key}`);
    if (reverse && reverse.reverse_relation !== relation) throw new Error(`Mongo relation has an ambiguous inverse: ${key}`);
    return {
        relation,
        related
    };
}
export function validateMongoRelations(owner, resolve) {
    for (const key of Object.keys(owner.schema.relations))requireMongoRelation(owner, key, resolve);
}
export function validateMongoRelationGraph(owner, resolve) {
    const visited = new Set();
    const visit = (current)=>{
        if (visited.has(current.modelType)) return;
        visited.add(current.modelType);
        current.assertAvailable();
        for (const key of Object.keys(current.schema.relations)){
            const { related } = requireMongoRelation(current, key, resolve);
            visit(related);
        }
    };
    visit(owner);
}
function validateMongoForeignKey(relation, related, value) {
    if (value === null || value === undefined) return;
    if (typeof value !== 'string') throw new Error(`Mongo foreign key requires a public ObjectId string: ${relation.foreign_key}`);
    const nativeId = related.codec.id(value);
    if (!(nativeId instanceof ObjectId) || nativeId.toHexString() !== value) throw new Error(`Mongo foreign key requires canonical public ObjectId text: ${relation.foreign_key}`);
}
export function validateMongoForeignKeys(owner, attributes, resolve) {
    for (const key of Object.keys(owner.schema.relations)){
        const { relation, related } = requireMongoRelation(owner, key, resolve);
        if (relation.type === 'belongsTo') validateMongoForeignKey(relation, related, attributes[relation.foreign_key]);
    }
}
export function mongoIncludes(owner, value, resolve) {
    owner.assertAvailable();
    if (value === undefined) return [];
    return [
        ...new Set(stringList(value, '$include'))
    ].map((key)=>{
        const included = requireMongoRelation(owner, key, resolve);
        included.related.assertAvailable();
        return included;
    });
}
function relatedJSON(owner, query) {
    return new Promise((accept, reject)=>{
        const callback = (error, value)=>error ? reject(error) : accept(value);
        owner.cursor(query).toJSON(callback);
    });
}
export async function fetchMongoIncludes(rows, includes) {
    for (const { relation, related } of includes){
        for (const row of rows){
            related.assertAvailable();
            let value;
            if (relation.type === 'belongsTo') {
                const foreignId = row[relation.foreign_key];
                validateMongoForeignKey(relation, related, foreignId);
                value = foreignId === null || foreignId === undefined ? null : await relatedJSON(related, {
                    id: foreignId,
                    $one: true
                });
                if (value !== null && !isRecord(value)) throw new Error('Mongo belongsTo include returned an unexpected row shape');
            } else {
                const reverse = relation.reverse_relation;
                if (!reverse) throw new Error(`Mongo ${relation.type} include lost its inverse`);
                if (row.id === null || row.id === undefined) throw new Error(`Mongo ${relation.type} include requires the private parent identity`);
                value = await relatedJSON(related, relation.type === 'hasOne' ? {
                    [reverse.foreign_key]: row.id,
                    $one: true
                } : {
                    [reverse.foreign_key]: row.id
                });
                if (relation.type === 'hasOne') {
                    if (value !== null && !isRecord(value)) throw new Error('Mongo hasOne include returned an unexpected row shape');
                } else if (!Array.isArray(value) || value.some((entry)=>!isRecord(entry))) throw new Error('Mongo hasMany include returned an unexpected row shape');
            }
            Object.defineProperty(row, relation.key, {
                value,
                enumerable: true,
                configurable: true,
                writable: true
            });
        }
    }
}
export function rejectMongoRelationPredicate(schema, field) {
    const root = field.split('.')[0];
    if (Reflect.getOwnPropertyDescriptor(schema.relations, root) !== undefined) throw new Error(`Mongo relation predicates are not implemented: ${field}`);
}
