import type { Db, MongoClient } from 'mongodb';
export declare function up(db: Db, _client: MongoClient): Promise<void>;
export declare function down(db: Db, _client: MongoClient): Promise<void>;
