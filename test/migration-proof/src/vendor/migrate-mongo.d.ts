declare module 'migrate-mongo' {
  import type { Db, MongoClient } from 'mongodb';

  export interface Config {
    mongodb: {
      url: string;
      databaseName: string;
      options: Record<string, unknown>;
    };
    migrationsDir: string;
    changelogCollectionName: string;
    lockCollectionName: string;
    lockTtl: number;
    migrationFileExtension: string;
    useFileHash: boolean;
    moduleSystem: 'esm' | 'commonjs';
  }

  export interface StatusItem {
    fileName: string;
    appliedAt: string;
    migrationBlock?: number;
  }

  export const config: {
    set(value: Config): void;
    read(): Promise<Config>;
  };
  export function create(description: string): Promise<string>;
  export function status(db: Db): Promise<StatusItem[]>;
  export function up(db: Db, client: MongoClient): Promise<string[]>;
  export function down(db: Db, client: MongoClient): Promise<string[]>;

  const migrateMongo: {
    config: typeof config;
    create: typeof create;
    status: typeof status;
    up: typeof up;
    down: typeof down;
  };
  export default migrateMongo;
}
