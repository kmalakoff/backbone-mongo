import { createHash } from 'node:crypto';
import ConnectionString from 'mongodb-connection-string-url';
import type { MongoSyncOptions } from '../types.ts';
import { copyValue } from './values.ts';

export interface MongoTarget {
  readonly collection: string;
  readonly database?: string;
  readonly key: string;
  readonly uri: string;
  readonly options: MongoSyncOptions;
}

export function resolveMongoTarget(modelURL: string, options: MongoSyncOptions): MongoTarget {
  try {
    // This is the Mongo driver's parser, including SRV, host lists and escaped credentials.
    const parsed = new ConnectionString(modelURL);
    const parts = parsed.pathname.split('/');
    if (parts[0] !== '' || parts.length < 2 || parts.length > 3 || !parts.at(-1)) throw new Error('Missing collection');
    const collection = decodeURIComponent(parts.at(-1) ?? '');
    const database = parts.length === 3 ? decodeURIComponent(parts[1]) : undefined;
    if (database === '') throw new Error('Missing database');
    parsed.pathname = parts.length === 3 ? `/${parts[1]}` : '/';
    parsed.searchParams.sort();
    const uri = parsed.toString();
    const key = `backbone-mongo:${createHash('sha256').update(uri).digest('hex')}`;
    return { collection, database, key, uri, options: copyValue(options) };
  } catch {
    throw new Error('Invalid Mongo model URL; expected a Mongo connection URI ending in a collection name');
  }
}
