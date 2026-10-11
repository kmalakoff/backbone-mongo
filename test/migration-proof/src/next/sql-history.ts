import knexFactory, { type Knex } from 'knex';
import { stat } from 'fs/promises';
import path from 'path';
import MigrationFacade, { MigrationPreparationFacade } from '../facade.ts';
import type { CreateResult, MigrationOperations, MigrationStatus } from '../types.ts';
import { createMigrationPreparationWorker, createMigrationWorker } from '../worker.ts';
import { historyIdentityIssue, MigrationUncertainStateError, type MutationOperation } from './errors.ts';
import { readCompiledMigrationIds } from './mongo-history.ts';

function migrationName(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'file' in value && typeof value.file === 'string') return value.file;
  throw new Error(`Unknown Knex migration identity: ${JSON.stringify(value)}`);
}

function config(directory: string): Knex.MigratorConfig {
  return { directory, extension: 'js', loadExtensions: ['.js'], tableName: 'knex_migrations' };
}

async function history(database: Knex): Promise<Array<{ id: number; name: string }>> {
  return database('knex_migrations').orderBy('id', 'asc').select('id', 'name');
}

function completedIds(operation: MutationOperation, before: Array<{ name: string }>, after: Array<{ name: string }>): string[] {
  const comparison = new Set((operation === 'up' ? before : after).map(({ name }) => name));
  return (operation === 'up' ? after : before).map(({ name }) => name).filter((name) => !comparison.has(name));
}

async function uncertain<T>(operation: MutationOperation, database: Knex, start: () => Promise<T>): Promise<T> {
  const before = await history(database);
  try {
    return await start();
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error));
    let knownCompletedIds: string[] = [];
    let historyInspected = true;
    try {
      knownCompletedIds = completedIds(operation, before, await history(database));
    } catch (historyError) {
      historyInspected = false;
      (cause as Error & { historyInspectionError?: Error }).historyInspectionError = historyError instanceof Error ? historyError : new Error(String(historyError));
    }
    throw new MigrationUncertainStateError(operation, cause, knownCompletedIds, historyInspected);
  }
}

export function createSqlHistoryFacade(database: Knex, migrationsDir: string, createDir: string): MigrationFacade {
  const migrationConfig = config(migrationsDir);
  const operations: MigrationOperations = {
    async create(name): Promise<CreateResult> {
      const sourcePath = await database.migrate.make(name, { directory: createDir, extension: 'ts' });
      return { sourceId: path.basename(sourcePath), deployedId: path.basename(sourcePath).replace(/\.ts$/, '.js') };
    },
    async status() {
      const [rawApplied, rawPending] = await database.migrate.list(migrationConfig);
      const applied = rawApplied as Array<{ name: string; migration_time: Date | string }>;
      const pending = rawPending as unknown[];
      return [...applied.map(({ name, migration_time: appliedAt }) => ({ id: name, state: 'applied' as const, appliedAt: new Date(appliedAt).toISOString() })), ...pending.map((migration) => ({ id: migrationName(migration), state: 'pending' as const }))] satisfies MigrationStatus[];
    },
    async up() {
      await database.migrate.list(migrationConfig);
      return uncertain('up', database, async () => {
        const [, applied] = await database.migrate.latest(migrationConfig);
        return { applied };
      });
    },
    async down() {
      await database.migrate.list(migrationConfig);
      const last = await database('knex_migrations').orderBy('id', 'desc').first<{ name: string }>('name');
      if (!last) return { reverted: [] };
      return uncertain('down', database, async () => {
        const [, reverted] = await database.migrate.down({ ...migrationConfig, name: last.name });
        return { reverted };
      });
    },
  };
  return new MigrationFacade(createMigrationWorker(operations));
}

export function createSqliteDatabase(filename: string): Knex {
  return knexFactory({ client: 'sqlite3', connection: { filename }, useNullAsDefault: true });
}

export interface SqlPreparationDatabase {
  client: 'sqlite3';
  connection: Pick<Knex.Sqlite3ConnectionConfig, 'filename'>;
  useNullAsDefault?: boolean;
  migrations?: Pick<Knex.MigratorConfig, 'tableName' | 'schemaName'>;
}

export interface SqlPreparationOptions {
  database: SqlPreparationDatabase;
  // One deployed directory containing .js migrations, including sample-migration.js.
  migrationsDir: string;
  createDir: string;
}

function validatePreparationRecord(input: object, fields: readonly string[], label: string): void {
  if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) throw new Error(`Unsupported preparation ${label}`);
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || fields.indexOf(key) < 0 || !Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(input, key) ?? {}, 'value')) throw new Error(`Unsupported preparation ${label} field: ${String(key)}`);
  }
}

export interface SqlPreparationObservation {
  operation: 'create' | 'status';
  poolClosed: boolean;
  queries: string[];
}

export function createSqlPreparationFacade(options: SqlPreparationOptions, observe?: (observation: SqlPreparationObservation) => void): MigrationPreparationFacade {
  const migrationsDir = path.resolve(options.migrationsDir);
  const createDir = path.resolve(options.createDir);
  const database = options.database;
  if (!database || typeof database !== 'object' || Array.isArray(database)) throw new Error('Unsupported preparation database');
  validatePreparationRecord(database, ['client', 'connection', 'useNullAsDefault', 'migrations'], 'database');
  if (database.client !== 'sqlite3') throw new Error('Preparation admits only the static sqlite3 client');
  const connection = database.connection;
  if (!connection || typeof connection !== 'object' || Array.isArray(connection)) throw new Error('Preparation requires a static SQLite filename');
  validatePreparationRecord(connection, ['filename'], 'connection');
  if (typeof connection.filename !== 'string' || connection.filename.length === 0) throw new Error('Preparation requires a static SQLite filename');
  if (database.useNullAsDefault !== undefined && typeof database.useNullAsDefault !== 'boolean') throw new Error('Unsupported preparation useNullAsDefault');
  const metadata = database.migrations;
  if (metadata !== undefined) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Unsupported preparation history metadata');
    validatePreparationRecord(metadata, ['tableName', 'schemaName'], 'history metadata');
    for (const value of [metadata.tableName, metadata.schemaName]) {
      if (value !== undefined && (typeof value !== 'string' || value.length === 0)) throw new Error('Preparation history names must be nonempty strings');
    }
  }
  const filename = connection.filename === ':memory:' ? connection.filename : path.resolve(connection.filename);
  const tableName = metadata?.tableName ?? 'knex_migrations';
  const schemaName = metadata?.schemaName;
  const configuration: Knex.Config = { client: 'sqlite3', connection: { filename }, useNullAsDefault: database.useNullAsDefault ?? true, migrations: { tableName, ...(schemaName === undefined ? {} : { schemaName }) } };

  async function owned<T>(operation: 'create' | 'status', start: (database: Knex) => Promise<T>): Promise<T> {
    const database = knexFactory(configuration);
    const queries: string[] = [];
    database.on('query', (query: { sql: string }) => queries.push(query.sql));
    let failed = false;
    let original: unknown;
    try {
      return await start(database);
    } catch (error) {
      failed = true;
      original = error;
      throw error;
    } finally {
      const cleanupFailures: unknown[] = [];
      try {
        await database.destroy();
      } catch (error) {
        cleanupFailures.push(error);
      }
      try {
        observe?.({ operation, poolClosed: database.client.pool === undefined, queries });
      } catch (error) {
        cleanupFailures.push(error);
      }
      if (cleanupFailures.length > 0) {
        if (failed) throw new AggregateError([original, ...cleanupFailures], 'Migration preparation and cleanup failed');
        if (cleanupFailures.length === 1) throw cleanupFailures[0];
        throw new AggregateError(cleanupFailures, 'Migration preparation cleanup failed');
      }
    }
  }

  return new MigrationPreparationFacade(createMigrationPreparationWorker({
    create(name) {
      return owned('create', async (database) => {
        const sourcePath = await database.migrate.make(name, { directory: createDir, extension: 'ts' });
        const sourceId = path.basename(sourcePath);
        return { sourceId, deployedId: sourceId.replace(/\.ts$/, '.js') };
      });
    },
    async status() {
      if (filename === ':memory:') throw new Error('Read-only migration status requires an existing SQLite file');
      if (!(await stat(filename)).isFile()) throw new Error('Read-only migration status requires an existing SQLite file');
      return owned('status', async (database) => {
        const files = await readCompiledMigrationIds(migrationsDir, '.js');
        const schema = schemaName ? database.schema.withSchema(schemaName) : database.schema;
        const exists = await schema.hasTable(tableName);
        const table = schemaName ? database(tableName).withSchema(schemaName) : database(tableName);
        const rows = exists ? await table.orderBy('id', 'asc').select<Array<{ name: unknown; migration_time: unknown }>>('name', 'migration_time') : [];
        const applied: MigrationStatus[] = rows.map((row) => {
          if (typeof row.name !== 'string' || row.name.length === 0) throw new Error('Unsupported Knex migration identity');
          if (!(row.migration_time instanceof Date) && typeof row.migration_time !== 'string' && typeof row.migration_time !== 'number') throw new Error('Unsupported Knex migration timestamp');
          const timestamp = new Date(row.migration_time);
          if (!Number.isFinite(timestamp.getTime())) throw new Error('Unsupported Knex migration timestamp');
          return { id: row.name, state: 'applied', appliedAt: timestamp.toISOString() };
        });
        const issue = historyIdentityIssue(files, applied.map(({ id }) => id));
        if (issue) throw new Error(`Knex status rejected ${issue.code}: ${issue.ids.join(', ')}`);
        const appliedIds = new Set(applied.map(({ id }) => id));
        return [...applied, ...files.filter((id) => !appliedIds.has(id)).map((id) => ({ id, state: 'pending' as const }))];
      });
    },
  }));
}
