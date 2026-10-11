import type { Db, MongoClient } from 'mongodb';

export async function up(db: Db, _client: MongoClient): Promise<void> {
  await db.collection<{ name: string }>('widgets').insertOne({ name: 'created' });
}

export async function down(db: Db, _client: MongoClient): Promise<void> {
  await db.collection('widgets').drop();
}
