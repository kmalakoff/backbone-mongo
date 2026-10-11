import type { Db, MongoClient } from 'mongodb';

export async function up(db: Db, client: MongoClient): Promise<void> {
  await db.collection('events').insertOne({ event: 'history-unavailable-write' });
  await client.close();
  throw new Error('failure after closing the migration client');
}

export async function down(db: Db, _client: MongoClient): Promise<void> {
  await db.collection('events').deleteMany({ event: 'history-unavailable-write' });
}
