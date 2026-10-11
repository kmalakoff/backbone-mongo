import type { Db, MongoClient } from 'mongodb';

export async function up(db: Db, _client: MongoClient): Promise<void> {
  await db.collection('events').insertOne({ event: 'backdated-up' });
}

export async function down(db: Db, _client: MongoClient): Promise<void> {
  await db.collection('events').insertOne({ event: 'backdated-down' });
}
