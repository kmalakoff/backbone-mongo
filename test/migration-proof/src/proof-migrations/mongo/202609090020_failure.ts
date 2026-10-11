import type { Db, MongoClient } from 'mongodb';

export async function up(db: Db, _client: MongoClient): Promise<void> {
  await db.collection('events').insertOne({ event: 'failure-write' });
  throw new Error('failure after Mongo data change');
}

export async function down(db: Db, _client: MongoClient): Promise<void> {
  await db.collection('events').deleteMany({ event: 'failure-write' });
}
