import type { Filter } from 'mongodb';
import type { MongoDocument } from '../types.ts';
import type DocumentCodec from './document.ts';
import { copyValue, isRecord, stringList } from './values.ts';

export const LOGICAL_OPERATORS = new Set(['$and', '$or', '$nor']);
const VALUE_OPERATORS = new Set(['$eq', '$ne', '$gt', '$gte', '$lt', '$lte']);
const MEMBERSHIP_OPERATORS = new Set(['$in', '$nin']);

function setField(target: object, field: string, value: unknown): void {
  Object.defineProperty(target, field, { value, enumerable: true, writable: true, configurable: true });
}

function isQueryDocument(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function fieldName(field: string): void {
  if (field.includes('\0') || field.split('.').some((part) => !part || part.startsWith('$'))) throw new Error(`Invalid Mongo query field: ${field}`);
}

function condition(value: unknown, field: string, codec: DocumentCodec): unknown {
  const convert = (operand: unknown): unknown => (field === 'id' ? codec.id(operand) : copyValue(operand));
  if (!isQueryDocument(value) || !Object.keys(value).some((key) => key.startsWith('$'))) return convert(value);
  const converted: Record<string, unknown> = {};
  for (const [operator, operand] of Object.entries(value)) {
    if (VALUE_OPERATORS.has(operator)) converted[operator] = convert(operand);
    else if (MEMBERSHIP_OPERATORS.has(operator)) {
      if (!Array.isArray(operand)) throw new Error(`Mongo ${field}.${operator} requires an array`);
      converted[operator] = operand.map(convert);
    } else if (operator === '$exists') {
      if (typeof operand !== 'boolean') throw new Error(`Mongo ${field}.$exists requires a boolean`);
      converted[operator] = operand;
    } else if (operator === '$not') {
      if (operand instanceof RegExp && field !== 'id') converted[operator] = copyValue(operand);
      else {
        if (!isQueryDocument(operand) || !Object.keys(operand).length || Object.keys(operand).some((key) => !key.startsWith('$') || key === '$not')) throw new Error(`Mongo ${field}.$not requires an operator expression`);
        converted[operator] = condition(operand, field, codec);
      }
    } else throw new Error(`Mongo predicate operator is not implemented: ${field}.${operator}`);
  }
  return converted;
}

function logical(operator: string, value: unknown, codec: DocumentCodec, fieldPolicy?: (field: string) => void): Filter<MongoDocument>[] {
  if (!Array.isArray(value) || !value.length) throw new Error(`Mongo ${operator} requires a nonempty array of query documents`);
  return value.map((child: unknown) => document(child, codec, fieldPolicy));
}

function document(value: unknown, codec: DocumentCodec, fieldPolicy?: (field: string) => void): Filter<MongoDocument> {
  if (!isQueryDocument(value)) throw new Error('Mongo predicates require query documents');
  const filter: Filter<MongoDocument> = {};
  for (const [field, operand] of Object.entries(value)) {
    if (LOGICAL_OPERATORS.has(field)) setField(filter, field, logical(field, operand, codec, fieldPolicy));
    else {
      if (field.startsWith('$')) throw new Error(`Mongo query operator is not implemented: ${field}`);
      fieldName(field);
      fieldPolicy?.(field);
      // Only a model predicate's root id is mapped; embedded literal/path ids are data.
      setField(filter, field === 'id' ? codec.idAttribute : field, condition(operand, field, codec));
    }
  }
  return filter;
}

export function compileFilter(find: Record<string, unknown>, cursor: Record<string, unknown>, codec: DocumentCodec, fieldPolicy?: (field: string) => void): Filter<MongoDocument> {
  const effective = { ...find };
  for (const operator of LOGICAL_OPERATORS) {
    if (Reflect.getOwnPropertyDescriptor(cursor, operator) === undefined) continue;
    // Cursor sections select the effective operand before validating overwritten find data.
    setField(effective, operator, cursor[operator]);
  }
  const filter = document(effective, codec, fieldPolicy);
  if (cursor.$ids !== undefined) {
    if (!Array.isArray(cursor.$ids)) throw new Error('$ids requires an array');
    // Existing $ids precedence replaces the root id condition, not logical child conditions.
    setField(filter, codec.idAttribute, { $in: cursor.$ids.map((id: unknown) => codec.id(id)) });
  }
  return filter;
}

export function compileSort(value: unknown, codec: DocumentCodec, fieldPolicy?: (field: string) => void): Record<string, 1 | -1> {
  const sort: Record<string, 1 | -1> = {};
  for (const part of stringList(value, '$sort')) {
    const trimmed = part.trim();
    const descending = trimmed.startsWith('-');
    const field = (descending ? trimmed.slice(1) : trimmed).trim();
    fieldName(field);
    fieldPolicy?.(field);
    setField(sort, field === 'id' ? codec.idAttribute : field, descending ? -1 : 1);
  }
  return sort;
}
