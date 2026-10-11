import type { Db, MongoClient } from 'mongodb';

export async function up(db: Db, _client: MongoClient): Promise<void> {
  await db.collection('events').insertOne({ event: 'race-up', pid: process.pid });
  await new Promise((resolve) => setTimeout(resolve, 500));
}

export async function down(db: Db, _client: MongoClient): Promise<void> {
  await db.collection('events').deleteMany({ event: 'race-up' });
}
