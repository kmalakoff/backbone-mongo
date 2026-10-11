import assert from 'assert';
import { type CreateResult, createMigrationWorker, type MigrationCallback, MigrationFacade, type MigrationOperations, type MigrationStatus } from 'backbone-mongo-migration-proof';
import { type ChildProcess, fork, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { copyFile, mkdir, readFile, symlink, writeFile } from 'fs/promises';
import { safeRm } from 'fs-remove-compat';
import knexFactory, { type Knex } from 'knex';
import migrateMongo, { type Config as MongoRunnerConfig } from 'migrate-mongo';
import { createRequire } from 'module';
import type { Db, MongoClient } from 'mongodb';
import path from 'path';
import { fileURLToPath } from 'url';

const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = path.resolve(fixtureRoot, '../..');
const builtRoot = path.join(fixtureRoot, 'dist', 'esm');
const builtMigrationsRoot = path.join(builtRoot, 'proof-migrations');
const evidenceRoot = path.join(fixtureRoot, 'evidence');

export const scratchRoot = path.join(repositoryRoot, '.tmp', `migration-proof-${process.pid}`);
export const mongoBinaryCacheRoot = path.join(repositoryRoot, '.tmp', 'cache', 'mongodb-binaries');

export type Evidence = Record<string, unknown>;

function safeRemove(target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    safeRm(target, (error) => (error ? reject(error) : resolve()));
  });
}

export async function prepareScratch(): Promise<void> {
  await safeRemove(scratchRoot);
  await safeRemove(path.join(evidenceRoot, 'generated'));
  await safeRemove(path.join(evidenceRoot, 'gate-1.json'));
  await mkdir(scratchRoot, { recursive: true });
  await mkdir(evidenceRoot, { recursive: true });
}

export async function prepareLifecycleScratch(): Promise<void> {
  await safeRemove(scratchRoot);
  await mkdir(scratchRoot, { recursive: true });
}

export async function cleanupScratch(): Promise<void> {
  await safeRemove(scratchRoot);
}

function digest(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function processOwnershipIdentityEvidence(): Promise<Evidence> {
  const identityFiles = ['package.json', 'package-lock.json', 'test/fixtures/process-tree-timeout.mjs', 'test/fixtures/stubborn-process.cjs', 'test/integration/process-ownership.test.ts', 'test/lib/proof.ts'];
  return {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    sourceIdentities: Object.fromEntries(await Promise.all(identityFiles.map(async (fileName) => [fileName, digest(await readFile(path.join(fixtureRoot, fileName)))] as const))),
  };
}

interface GeneratedBuild {
  command: string;
  sourcePath: string;
  deployedPath: string;
  migrationsDir: string;
  retainedSourcePath: string;
  retainedDeployedPath: string;
  retainedDeclarationPath: string;
  retainedPackagePath: string;
  retainedTsconfigPath: string;
  stdout: string;
  stderr: string;
  sourceSha256: string;
  deployedSha256: string;
}

export async function buildGeneratedMigration(backend: 'mongo' | 'sql', sourcePath: string, roots = { scratchRoot, evidenceRoot }): Promise<GeneratedBuild> {
  const buildRoot = path.join(roots.scratchRoot, backend, 'generated-build');
  const sourceDir = path.join(buildRoot, 'src');
  const sourceId = path.basename(sourcePath);
  const copiedSourcePath = path.join(sourceDir, sourceId);
  await mkdir(sourceDir, { recursive: true });
  await copyFile(sourcePath, copiedSourcePath);
  await symlink(path.join(fixtureRoot, 'node_modules'), path.join(buildRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(
    path.join(buildRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: `generated-${backend}-migration-proof`,
        version: '0.0.0',
        private: true,
        type: 'module',
        source: `src/${sourceId}`,
        tsds: { targets: ['esm'] },
      },
      null,
      2
    )}\n`
  );
  await writeFile(
    path.join(buildRoot, 'tsconfig.json'),
    `${JSON.stringify(
      {
        extends: 'tsds-config/tsconfig.json',
        compilerOptions: { outDir: 'dist', types: ['node'] },
        include: ['src'],
        exclude: ['node_modules', 'dist'],
      },
      null,
      2
    )}\n`
  );

  const command = `${process.execPath} ${path.join(fixtureRoot, 'test', 'fixtures', 'compiler-callback.mjs')}`;
  const worker = launchOwnedCompiler(buildRoot, 60_000);
  let result: OwnedCompilerResult | undefined;
  let failed = false;
  let original: unknown;
  try {
    result = await worker.wait();
    assert.equal(result.signal, null, `Generated ${backend} migration compiler was signalled:\n${result.stdout}\n${result.stderr}`);
    if (!result.callback.ok) {
      const error = new Error(result.callback.error.message);
      error.name = result.callback.error.name;
      error.stack = result.callback.error.stack;
      throw Object.assign(error, { command, stdout: result.stdout, stderr: result.stderr, callback: result.callback });
    }
    assert.equal(result.status, 0, `Generated ${backend} migration tsds build failed:\n${result.stdout}\n${result.stderr}`);
  } catch (error) {
    failed = true;
    original = error;
  }
  let cleanupFailed = false;
  let cleanupFailure: unknown;
  try { await worker.close(); }
  catch (error) { cleanupFailed = true; cleanupFailure = error; }
  if (failed && cleanupFailed) throw new AggregateError([original, cleanupFailure], 'Generated build and process cleanup failed');
  if (failed) throw original;
  if (cleanupFailed) throw cleanupFailure;
  assert.ok(result);
  const stdout = result.stdout;
  const stderr = result.stderr;
  const deployedPath = path.join(buildRoot, 'dist', 'esm', sourceId.replace(/\.ts$/, '.js'));
  const declarationPath = deployedPath.replace(/\.js$/, '.d.ts');
  const retainedDir = path.join(roots.evidenceRoot, 'generated', backend);
  const retainedSourcePath = path.join(retainedDir, sourceId);
  const retainedDeployedPath = path.join(retainedDir, path.basename(deployedPath));
  const retainedDeclarationPath = path.join(retainedDir, path.basename(declarationPath));
  const retainedPackagePath = path.join(retainedDir, 'package.json');
  const retainedTsconfigPath = path.join(retainedDir, 'tsconfig.json');
  await mkdir(retainedDir, { recursive: true });
  await Promise.all([copyFile(sourcePath, retainedSourcePath), copyFile(deployedPath, retainedDeployedPath), copyFile(declarationPath, retainedDeclarationPath), copyFile(path.join(buildRoot, 'package.json'), retainedPackagePath), copyFile(path.join(buildRoot, 'tsconfig.json'), retainedTsconfigPath)]);
  const sourceContent = await readFile(sourcePath);
  const copiedContent = await readFile(copiedSourcePath);
  assert.equal(digest(copiedContent), digest(sourceContent));
  return {
    command,
    sourcePath,
    deployedPath,
    migrationsDir: path.dirname(deployedPath),
    retainedSourcePath,
    retainedDeployedPath,
    retainedDeclarationPath,
    retainedPackagePath,
    retainedTsconfigPath,
    stdout,
    stderr,
    sourceSha256: digest(sourceContent),
    deployedSha256: digest(await readFile(deployedPath)),
  };
}

async function createMigrationDirectory(backend: 'mongo' | 'sql', label: string, fileNames: string[]): Promise<string> {
  const destination = path.join(scratchRoot, backend, label, 'migrations');
  await mkdir(destination, { recursive: true });
  for (const fileName of fileNames) {
    await copyFile(path.join(builtMigrationsRoot, backend, fileName), path.join(destination, fileName));
  }
  return destination;
}

function migrationName(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'file' in value && typeof value.file === 'string') return value.file;
  throw new Error(`Unknown Knex migration identity: ${JSON.stringify(value)}`);
}

function sqlConfig(directory: string): Knex.MigratorConfig {
  return {
    directory,
    extension: 'js',
    loadExtensions: ['.js'],
    tableName: 'knex_migrations',
  };
}

function sqlStatus(completed: { name: string }[], pending: unknown[]): MigrationStatus[] {
  return [...completed.map(({ name }) => ({ id: name, state: 'applied' as const })), ...pending.map((migration) => ({ id: migrationName(migration), state: 'pending' as const }))];
}

function createSqlFacade(database: Knex, migrationsDir: string, createDir: string): MigrationFacade {
  const config = sqlConfig(migrationsDir);
  const operations: MigrationOperations = {
    async create(name): Promise<CreateResult> {
      const sourcePath = await database.migrate.make(name, {
        directory: createDir,
        extension: 'ts',
        stub: path.join(fixtureRoot, 'test', 'fixtures', 'knex.stub.ts'),
      });
      return { sourceId: path.basename(sourcePath), deployedId: path.basename(sourcePath).replace(/\.ts$/, '.js') };
    },
    async status() {
      const [completed, pending] = await database.migrate.list(config);
      return sqlStatus(completed, pending);
    },
    async up() {
      const [, applied] = await database.migrate.latest(config);
      return { applied };
    },
    async down() {
      const [, reverted] = await database.migrate.down(config);
      return { reverted };
    },
  };
  return new MigrationFacade(createMigrationWorker(operations));
}

function mongoConfig(uri: string, databaseName: string, migrationsDir: string): MongoRunnerConfig {
  return {
    mongodb: { url: uri, databaseName, options: {} },
    migrationsDir,
    changelogCollectionName: 'changelog',
    lockCollectionName: 'changelog_lock',
    lockTtl: 60,
    migrationFileExtension: '.js',
    useFileHash: false,
    moduleSystem: 'esm',
  };
}

function createMongoFacade(uri: string, client: MongoClient, databaseName: string, migrationsDir: string, createDir: string): MigrationFacade {
  const database = client.db(databaseName);
  const deployedConfig = mongoConfig(uri, databaseName, migrationsDir);
  const operations: MigrationOperations = {
    async create(name) {
      const createConfig = { ...deployedConfig, migrationsDir: createDir, migrationFileExtension: '.ts' };
      migrateMongo.config.set(createConfig);
      const sourceId = await migrateMongo.create(name);
      migrateMongo.config.set(deployedConfig);
      return { sourceId, deployedId: sourceId.replace(/\.ts$/, '.js') };
    },
    async status() {
      migrateMongo.config.set(deployedConfig);
      const items = await migrateMongo.status(database);
      return items.map((item) => ({
        id: item.fileName,
        state: item.appliedAt === 'PENDING' ? ('pending' as const) : ('applied' as const),
        ...(item.appliedAt === 'PENDING' ? {} : { appliedAt: item.appliedAt }),
      }));
    },
    async up() {
      migrateMongo.config.set(deployedConfig);
      return { applied: await migrateMongo.up(database, client) };
    },
    async down() {
      migrateMongo.config.set(deployedConfig);
      return { reverted: await migrateMongo.down(database, client) };
    },
  };
  return new MigrationFacade(createMigrationWorker(operations));
}

interface CallbackOutcome<T> {
  calls: number;
  error: string | null;
  result?: T;
  resultProvided: boolean;
  returnedType: 'undefined';
}

function callbackOutcome<T>(invoke: (callback: MigrationCallback<T>) => void): Promise<CallbackOutcome<T>> {
  return new Promise((resolve, reject) => {
    let calls = 0;
    const timer = setTimeout(() => reject(new Error('Timed out waiting for facade callback')), 5_000);
    const returned = invoke((error, result) => {
      calls++;
      setImmediate(() => {
        clearTimeout(timer);
        try {
          assert.equal(calls, 1);
          resolve({
            calls,
            error: error?.message ?? null,
            ...(result === undefined ? {} : { result }),
            resultProvided: result !== undefined,
            returnedType: 'undefined',
          });
        } catch (assertionError) {
          reject(assertionError);
        }
      });
    });
    assert.equal(returned, undefined);
  });
}

async function promiseOutcome<T>(invoke: () => Promise<T>): Promise<{ error: string | null; result?: T; resultProvided: boolean; returnedType: 'Promise' }> {
  const returned = invoke();
  assert.equal(returned instanceof Promise, true);
  try {
    return { error: null, result: await returned, resultProvided: true, returnedType: 'Promise' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), resultProvided: false, returnedType: 'Promise' };
  }
}

function callbackStatus(facade: MigrationFacade): Promise<{ returnedType: 'undefined'; status: MigrationStatus[] }> {
  return callbackOutcome<MigrationStatus[]>((callback) => facade.status(callback)).then((outcome) => {
    if (outcome.error) throw new Error(outcome.error);
    if (!outcome.result) throw new Error('Callback status completed without a result');
    return { returnedType: outcome.returnedType, status: outcome.result };
  });
}

async function expectedFailure(operation: () => Promise<unknown>): Promise<string> {
  try {
    await operation();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected operation to fail');
}

export async function packageEvidence(): Promise<Evidence> {
  const packageLockContent = await readFile(path.join(fixtureRoot, 'package-lock.json'));
  const packageLock = JSON.parse(packageLockContent.toString()) as {
    packages: Record<string, { version?: string; resolved?: string; integrity?: string }>;
  };
  const selected = ['knex', 'migrate-mongo', 'mongodb', 'mongodb-memory-server', 'sqlite3', 'ts-dev-stack', 'tsds-config'];
  const packages = Object.fromEntries(
    selected.map((name) => {
      const item = packageLock.packages[`node_modules/${name}`];
      return [name, { version: item.version, resolved: item.resolved, integrity: item.integrity }];
    })
  );
  const require = createRequire(import.meta.url);
  const requiredMongo = require('migrate-mongo') as Record<string, unknown>;
  const importedMongo = await import('migrate-mongo');
  const importedKnex = await import('knex');
  const identityFiles = [
    'package.json',
    'package-lock.json',
    'src/facade.ts',
    'src/types.ts',
    'src/worker.ts',
    'src/workers/mongo-up.ts',
    'src/proof-migrations/mongo/202609090001_baseline.ts',
    'src/proof-migrations/mongo/202609090005_order_backdated.ts',
    'src/proof-migrations/mongo/202609090010_order_new.ts',
    'src/proof-migrations/mongo/202609090020_failure.ts',
    'src/proof-migrations/mongo/202609090030_race.ts',
    'src/proof-migrations/sql/202609090001_baseline.ts',
    'src/proof-migrations/sql/202609090005_order_backdated.ts',
    'src/proof-migrations/sql/202609090010_order_new.ts',
    'src/proof-migrations/sql/202609090020_failure.ts',
    'src/proof-migrations/sql/202609090025_down_failure.ts',
    'test/fixtures/knex.stub.ts',
    'test/fixtures/sample-migration.ts',
    'test/integration/gate-1.test.ts',
    'test/lib/proof.ts',
    'test/unit/worker.test.ts',
    'test/types/facade-consumer.ts',
  ];
  const sourceIdentities = Object.fromEntries(await Promise.all(identityFiles.map(async (fileName) => [fileName, digest(await readFile(path.join(fixtureRoot, fileName)))] as const)));
  assert.deepEqual(Object.keys(requiredMongo), []);
  assert.equal(typeof requiredMongo.up, 'object');
  assert.equal(await Promise.resolve(requiredMongo.up).then((value) => typeof value), 'function');
  return {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    fixturePackageSha256: digest(await readFile(path.join(fixtureRoot, 'package.json'))),
    packageLockSha256: digest(packageLockContent),
    sourceIdentities,
    packages,
    exports: {
      knexImportKeys: Object.keys(importedKnex).sort(),
      migrateMongoImportKeys: Object.keys(importedMongo).sort(),
      migrateMongoRequireKeys: Object.keys(requiredMongo).sort(),
      migrateMongoRequireUpType: typeof requiredMongo.up,
      migrateMongoRequireUpResolvesTo: await Promise.resolve(requiredMongo.up).then((value) => typeof value),
    },
  };
}

export async function sqlEvidence(): Promise<Evidence> {
  const createDir = path.join(scratchRoot, 'sql', 'create', 'migrations');
  await mkdir(createDir, { recursive: true });
  const databasePath = path.join(scratchRoot, 'sql', 'baseline.sqlite');
  const database = knexFactory({ client: 'sqlite3', connection: { filename: databasePath }, useNullAsDefault: true });
  try {
    const createFacade = createSqlFacade(database, createDir, createDir);
    const created = await createFacade.create('created_by_knex');
    const generatedBuild = await buildGeneratedMigration('sql', path.join(createDir, created.sourceId));
    const facade = createSqlFacade(database, generatedBuild.migrationsDir, createDir);
    const before = await facade.status();
    const applied = await facade.up();
    const promiseStatus = await facade.status();
    const callback = await callbackStatus(facade);
    const reverted = await facade.down();
    const after = await facade.status();
    const widgetsExists = await database.schema.hasTable('widgets');
    assert.equal(before[0]?.state, 'pending');
    assert.deepEqual(applied.applied, [created.deployedId]);
    assert.deepEqual(callback.status, promiseStatus);
    assert.deepEqual(reverted.reverted, [created.deployedId]);
    assert.equal(after[0]?.state, 'pending');
    assert.equal(widgetsExists, false);
    return {
      create: created,
      statusBefore: before,
      up: applied,
      callbackReturnType: callback.returnedType,
      statusAfterUp: promiseStatus,
      down: reverted,
      statusAfterDown: after,
      generatedBuild,
    };
  } finally {
    await database.destroy();
  }
}

export async function sqlFacadeParityEvidence(): Promise<Evidence> {
  const baselineFile = '202609090001_baseline.js';
  const migrationsDir = await createMigrationDirectory('sql', 'facade-parity', [baselineFile]);
  const upFailureFile = '202609090020_failure.js';
  const upFailureDir = await createMigrationDirectory('sql', 'facade-parity-up-failure', [upFailureFile]);
  const downFailureFile = '202609090025_down_failure.js';
  const downFailureDir = await createMigrationDirectory('sql', 'facade-parity-down-failure', [downFailureFile]);
  const promiseCreateDir = path.join(scratchRoot, 'sql', 'facade-parity-create-promise');
  const callbackCreateDir = path.join(scratchRoot, 'sql', 'facade-parity-create-callback');
  await Promise.all([mkdir(promiseCreateDir, { recursive: true }), mkdir(callbackCreateDir, { recursive: true })]);
  const databases: Knex[] = [];
  const makeDatabase = (label: string): Knex => {
    const database = knexFactory({
      client: 'sqlite3',
      connection: { filename: path.join(scratchRoot, 'sql', `${label}.sqlite`) },
      useNullAsDefault: true,
    });
    databases.push(database);
    return database;
  };
  const promiseDatabase = makeDatabase('facade-parity-promise');
  const callbackDatabase = makeDatabase('facade-parity-callback');
  const statusPromiseDatabase = makeDatabase('facade-parity-status-error-promise');
  const statusCallbackDatabase = makeDatabase('facade-parity-status-error-callback');
  const upPromiseDatabase = makeDatabase('facade-parity-up-error-promise');
  const upCallbackDatabase = makeDatabase('facade-parity-up-error-callback');
  const downPromiseDatabase = makeDatabase('facade-parity-down-error-promise');
  const downCallbackDatabase = makeDatabase('facade-parity-down-error-callback');
  try {
    const promiseFacade = createSqlFacade(promiseDatabase, migrationsDir, promiseCreateDir);
    const callbackFacade = createSqlFacade(callbackDatabase, migrationsDir, callbackCreateDir);

    const createSuccess = {
      promise: await promiseOutcome(() => promiseFacade.create('facade_parity')),
      callback: await callbackOutcome<CreateResult>((callback) => callbackFacade.create('facade_parity', callback)),
    };
    const statusSuccess = {
      promise: await promiseOutcome(() => promiseFacade.status()),
      callback: await callbackOutcome<MigrationStatus[]>((callback) => callbackFacade.status(callback)),
    };
    const upSuccess = {
      promise: await promiseOutcome(() => promiseFacade.up()),
      callback: await callbackOutcome((callback) => callbackFacade.up(callback)),
    };
    const downSuccess = {
      promise: await promiseOutcome(() => promiseFacade.down()),
      callback: await callbackOutcome((callback) => callbackFacade.down(callback)),
    };

    assert.equal(createSuccess.promise.error, null);
    assert.equal(createSuccess.callback.error, null);
    assert.equal(createSuccess.promise.result?.sourceId.replace(/^\d+_/, ''), 'facade_parity.ts');
    assert.equal(createSuccess.callback.result?.sourceId.replace(/^\d+_/, ''), 'facade_parity.ts');
    assert.deepEqual(statusSuccess.promise.result, statusSuccess.callback.result);
    assert.deepEqual(upSuccess.promise.result, upSuccess.callback.result);
    assert.deepEqual(downSuccess.promise.result, downSuccess.callback.result);
    assert.deepEqual(upSuccess.promise.result, { applied: [baselineFile] });
    assert.deepEqual(downSuccess.promise.result, { reverted: [baselineFile] });
    for (const [operation, outcomes] of Object.entries({ createSuccess, statusSuccess, upSuccess, downSuccess })) {
      assert.equal(outcomes.promise.error, null, `${operation} Promise form should succeed`);
      assert.equal(outcomes.callback.error, null, `${operation} callback form should succeed`);
      assert.equal(outcomes.promise.resultProvided, true);
      assert.equal(outcomes.callback.resultProvided, true);
      assert.equal(outcomes.callback.calls, 1);
      assert.equal(outcomes.callback.returnedType, 'undefined');
      assert.equal(outcomes.promise.returnedType, 'Promise');
    }

    await Promise.all([statusPromiseDatabase, statusCallbackDatabase].map((database) => database.schema.createTable('knex_migrations', (table) => table.integer('unexpected'))));
    await Promise.all(
      [upPromiseDatabase, upCallbackDatabase, downPromiseDatabase, downCallbackDatabase].map((database) =>
        database.schema.createTable('events', (table) => {
          table.increments('id').primary();
          table.text('event').notNullable();
        })
      )
    );
    await Promise.all([downPromiseDatabase.migrate.latest(sqlConfig(downFailureDir)), downCallbackDatabase.migrate.latest(sqlConfig(downFailureDir))]);

    const statusPromiseFacade = createSqlFacade(statusPromiseDatabase, migrationsDir, promiseCreateDir);
    const statusCallbackFacade = createSqlFacade(statusCallbackDatabase, migrationsDir, callbackCreateDir);
    const upPromiseFacade = createSqlFacade(upPromiseDatabase, upFailureDir, promiseCreateDir);
    const upCallbackFacade = createSqlFacade(upCallbackDatabase, upFailureDir, callbackCreateDir);
    const downPromiseFacade = createSqlFacade(downPromiseDatabase, downFailureDir, promiseCreateDir);
    const downCallbackFacade = createSqlFacade(downCallbackDatabase, downFailureDir, callbackCreateDir);
    const errors = {
      create: {
        promise: await promiseOutcome(() => promiseFacade.create('')),
        callback: await callbackOutcome<CreateResult>((callback) => callbackFacade.create('', callback)),
      },
      status: {
        promise: await promiseOutcome(() => statusPromiseFacade.status()),
        callback: await callbackOutcome<MigrationStatus[]>((callback) => statusCallbackFacade.status(callback)),
      },
      up: {
        promise: await promiseOutcome(() => upPromiseFacade.up()),
        callback: await callbackOutcome((callback) => upCallbackFacade.up(callback)),
      },
      down: {
        promise: await promiseOutcome(() => downPromiseFacade.down()),
        callback: await callbackOutcome((callback) => downCallbackFacade.down(callback)),
      },
    };
    for (const [operation, outcomes] of Object.entries(errors)) {
      assert.ok(outcomes.promise.error, `${operation} Promise form should fail`);
      assert.equal(outcomes.callback.error, outcomes.promise.error);
      assert.equal(outcomes.promise.resultProvided, false);
      assert.equal(outcomes.callback.resultProvided, false);
      assert.equal(outcomes.callback.calls, 1);
      assert.equal(outcomes.callback.returnedType, 'undefined');
      assert.equal(outcomes.promise.returnedType, 'Promise');
    }
    assert.equal(errors.create.promise.error, 'A name must be specified for the generated migration');
    assert.equal(errors.up.promise.error, 'failure after SQL data change');
    assert.equal(errors.down.promise.error, 'failure after SQL down data change');

    const errorState = {
      upPromise: {
        data: await upPromiseDatabase('events').select('event'),
        history: await upPromiseDatabase('knex_migrations').select('name'),
      },
      upCallback: {
        data: await upCallbackDatabase('events').select('event'),
        history: await upCallbackDatabase('knex_migrations').select('name'),
      },
      downPromise: {
        data: await downPromiseDatabase('events').select('event'),
        history: await downPromiseDatabase('knex_migrations').select('name'),
      },
      downCallback: {
        data: await downCallbackDatabase('events').select('event'),
        history: await downCallbackDatabase('knex_migrations').select('name'),
      },
    };
    assert.deepEqual(errorState.upPromise, { data: [{ event: 'failure-write' }], history: [] });
    assert.deepEqual(errorState.upCallback, errorState.upPromise);
    assert.deepEqual(errorState.downPromise, {
      data: [{ event: 'down-prepared' }, { event: 'down-failure-write' }],
      history: [{ name: downFailureFile }],
    });
    assert.deepEqual(errorState.downCallback, errorState.downPromise);

    return { createSuccess, statusSuccess, upSuccess, downSuccess, errors, errorState };
  } finally {
    await Promise.all(databases.map((database) => database.destroy()));
  }
}

export async function sqlOrderingAndFailureEvidence(): Promise<Evidence> {
  const newFile = '202609090010_order_new.js';
  const backdatedFile = '202609090005_order_backdated.js';
  const orderDir = await createMigrationDirectory('sql', 'order', [newFile]);
  const orderDatabase = knexFactory({
    client: 'sqlite3',
    connection: { filename: path.join(scratchRoot, 'sql', 'order.sqlite') },
    useNullAsDefault: true,
  });
  let ordering: Evidence;
  try {
    await orderDatabase.schema.createTable('events', (table) => {
      table.increments('id').primary();
      table.text('event').notNullable();
    });
    await orderDatabase.migrate.latest(sqlConfig(orderDir));
    await copyFile(path.join(builtMigrationsRoot, 'sql', backdatedFile), path.join(orderDir, backdatedFile));
    await orderDatabase.migrate.latest(sqlConfig(orderDir));
    const applicationOrder = await orderDatabase('knex_migrations').orderBy('id').select('name');
    const [, reverted] = await orderDatabase.migrate.down(sqlConfig(orderDir));
    const events = await orderDatabase('events').orderBy('id').select('event');
    ordering = { applicationOrder, reverted, events };
    assert.deepEqual(
      applicationOrder.map(({ name }) => name),
      [newFile, backdatedFile]
    );
    assert.deepEqual(reverted, [newFile]);
    assert.deepEqual(events, [{ event: 'new-up' }, { event: 'backdated-up' }, { event: 'new-down' }]);
  } finally {
    await orderDatabase.destroy();
  }

  const failureFile = '202609090020_failure.js';
  const failureDir = await createMigrationDirectory('sql', 'failure', [failureFile]);
  const failureDatabase = knexFactory({
    client: 'sqlite3',
    connection: { filename: path.join(scratchRoot, 'sql', 'failure.sqlite') },
    useNullAsDefault: true,
  });
  try {
    await failureDatabase.schema.createTable('events', (table) => {
      table.increments('id').primary();
      table.text('event').notNullable();
    });
    const error = await expectedFailure(() => failureDatabase.migrate.latest(sqlConfig(failureDir)));
    const data = await failureDatabase('events').select('event');
    const history = await failureDatabase('knex_migrations').select('name');
    assert.equal(error, 'failure after SQL data change');
    assert.deepEqual(data, [{ event: 'failure-write' }]);
    assert.deepEqual(history, []);
    return { ordering, failure: { error, data, history } };
  } finally {
    await failureDatabase.destroy();
  }
}

export async function mongoBaselineEvidence(uri: string, client: MongoClient): Promise<Evidence> {
  const createDir = path.join(scratchRoot, 'mongo', 'create', 'migrations');
  await mkdir(createDir, { recursive: true });
  await copyFile(path.join(fixtureRoot, 'test', 'fixtures', 'sample-migration.ts'), path.join(createDir, 'sample-migration.ts'));
  const createFacade = createMongoFacade(uri, client, 'gate1_baseline', createDir, createDir);
  const created = await createFacade.create('created_by_migrate_mongo');
  const generatedBuild = await buildGeneratedMigration('mongo', path.join(createDir, created.sourceId));
  const facade = createMongoFacade(uri, client, 'gate1_baseline', generatedBuild.migrationsDir, createDir);
  const before = await facade.status();
  const applied = await facade.up();
  const promiseStatus = await facade.status();
  const callback = await callbackStatus(facade);
  const reverted = await facade.down();
  const after = await facade.status();
  const widgetsCollections = await client.db('gate1_baseline').listCollections({ name: 'widgets' }, { nameOnly: true }).toArray();
  assert.equal(before[0]?.state, 'pending');
  assert.deepEqual(applied.applied, [created.deployedId]);
  assert.deepEqual(callback.status, promiseStatus);
  assert.deepEqual(reverted.reverted, [created.deployedId]);
  assert.equal(after[0]?.state, 'pending');
  assert.deepEqual(widgetsCollections, []);
  return {
    create: created,
    statusBefore: before,
    up: applied,
    callbackReturnType: callback.returnedType,
    statusAfterUp: promiseStatus,
    down: reverted,
    statusAfterDown: after,
    widgetsCollectionsAfterDown: widgetsCollections,
    generatedBuild,
  };
}

export async function mongoCrossTalkEvidence(uri: string, client: MongoClient): Promise<Evidence> {
  const firstFile = '202609090001_baseline.js';
  const secondFile = '202609090030_race.js';
  const firstDir = await createMigrationDirectory('mongo', 'crosstalk-a', [firstFile]);
  const secondDir = await createMigrationDirectory('mongo', 'crosstalk-b', [secondFile]);
  const database = client.db('gate1_crosstalk');
  const firstConfig = mongoConfig(uri, database.databaseName, firstDir);
  const secondConfig = mongoConfig(uri, database.databaseName, secondDir);
  migrateMongo.config.set(firstConfig);
  await migrateMongo.up(database, client);
  migrateMongo.config.set(firstConfig);
  const statusPromise = migrateMongo.status(database);
  migrateMongo.config.set(secondConfig);
  const observed = await statusPromise;
  assert.deepEqual(
    observed.map(({ fileName }) => fileName),
    [secondFile]
  );
  return { expectedForFirstConfig: firstFile, observedAfterSecondSet: observed };
}

export async function mongoOrderingAndFailureEvidence(uri: string, client: MongoClient): Promise<Evidence> {
  const newFile = '202609090010_order_new.js';
  const backdatedFile = '202609090005_order_backdated.js';
  const orderDir = await createMigrationDirectory('mongo', 'order', [newFile]);
  const orderDatabase = client.db('gate1_order');
  const orderConfig = mongoConfig(uri, orderDatabase.databaseName, orderDir);
  migrateMongo.config.set(orderConfig);
  await migrateMongo.up(orderDatabase, client);
  await copyFile(path.join(builtMigrationsRoot, 'mongo', backdatedFile), path.join(orderDir, backdatedFile));
  migrateMongo.config.set(orderConfig);
  await migrateMongo.up(orderDatabase, client);
  const applicationOrder = await orderDatabase.collection('changelog').find({}).sort({ _id: 1 }).toArray();
  migrateMongo.config.set(orderConfig);
  const reverted = await migrateMongo.down(orderDatabase, client);
  const events = await orderDatabase.collection('events').find({}).sort({ _id: 1 }).project({ _id: 0 }).toArray();
  assert.deepEqual(
    applicationOrder.map(({ fileName }) => fileName),
    [newFile, backdatedFile]
  );
  assert.deepEqual(reverted, [newFile]);
  assert.deepEqual(events, [{ event: 'new-up' }, { event: 'backdated-up' }, { event: 'new-down' }]);

  const failureFile = '202609090020_failure.js';
  const failureDir = await createMigrationDirectory('mongo', 'failure', [failureFile]);
  const failureDatabase = client.db('gate1_failure');
  const failureConfig = mongoConfig(uri, failureDatabase.databaseName, failureDir);
  migrateMongo.config.set(failureConfig);
  const error = await expectedFailure(() => migrateMongo.up(failureDatabase, client));
  const data = await failureDatabase.collection('events').find({}).project({ _id: 0 }).toArray();
  const history = await failureDatabase.collection('changelog').find({}).project({ _id: 0 }).toArray();
  assert.equal(error, 'Could not migrate up 202609090020_failure.js: failure after Mongo data change');
  assert.deepEqual(data, [{ event: 'failure-write' }]);
  assert.deepEqual(history, []);
  return {
    ordering: {
      applicationOrder: applicationOrder.map(({ fileName }) => fileName),
      reverted,
      events,
    },
    failure: { error, data, history },
  };
}

interface RaceResult {
  type: 'result';
  ok: boolean;
  applied?: string[];
  error?: string;
  pid?: number;
  clientClosed?: boolean;
}

interface RaceExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
}

interface SerializedProcessError {
  name: string;
  message: string;
  code?: string;
  path?: string;
  syscall?: string;
}

type RaceTerminal =
  | {
      kind: 'failed-launch';
      error: Error;
      close: { code: number | null; signal: NodeJS.Signals | null };
      stderr: string;
    }
  | {
      kind: 'exited';
      exit: { code: number | null; signal: NodeJS.Signals | null };
      close: { code: number | null; signal: NodeJS.Signals | null };
      postSpawnErrors: Error[];
      stderr: string;
    }
  | {
      kind: 'closed-without-exit';
      close: { code: number | null; signal: NodeJS.Signals | null };
      postSpawnErrors: Error[];
      stderr: string;
    };

interface RaceTiming {
  phaseMs: number;
  gracefulTerminationMs: number;
  forceTerminationMs: number;
}

interface TerminationOutcome {
  terminal: RaceTerminal;
  escalated: boolean;
  gracefulError?: Error;
  forceError?: Error;
}

interface RaceWorker {
  child: ChildProcess;
  ready: Promise<void>;
  result: Promise<RaceResult>;
  postSpawnError: Promise<Error>;
  terminal: Promise<RaceTerminal>;
  state: {
    spawned: boolean;
    ready: boolean;
    readyMessage?: Record<string, unknown>;
    result: boolean;
    exited: boolean;
    closed: boolean;
    launchError?: Error;
    postSpawnErrors: Error[];
    terminal?: RaceTerminal;
    stdout: string;
    stderr: string;
  };
}

const ownedRaceWorkers = new Set<RaceWorker>();

interface RaceLaunchOptions {
  cwd?: string;
  execPath?: string;
  modulePath?: string;
  args?: string[];
}

interface OwnedProcessError extends Error {
  cleanup?: TerminationOutcome[];
  cleanupError?: unknown;
}

const defaultRaceTiming: RaceTiming = {
  phaseMs: 15_000,
  gracefulTerminationMs: 2_000,
  forceTerminationMs: 5_000,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isRaceResult(message: Record<string, unknown>): message is Record<string, unknown> & RaceResult {
  return message.type === 'result' && typeof message.ok === 'boolean';
}

function launchRaceWorker(options: { uri: string; databaseName: string; migrationsDir: string } | string, launch: RaceLaunchOptions = {}): RaceWorker {
  const encodedOptions = typeof options === 'string' ? options : JSON.stringify(options);
  const child = fork(launch.modulePath ?? path.join(builtRoot, 'workers', 'mongo-up.js'), launch.args ?? [encodedOptions], {
    ...(launch.execPath ? { execPath: launch.execPath } : {}),
    ...(launch.cwd ? { cwd: launch.cwd } : {}),
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const state: RaceWorker['state'] = {
    spawned: false,
    ready: false,
    result: false,
    exited: false,
    closed: false,
    postSpawnErrors: [],
    stdout: '',
    stderr: '',
  };
  child.stdout?.on('data', (chunk: Buffer) => {
    state.stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    state.stderr += chunk.toString();
  });
  let readyResolve: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });
  let resultResolve: ((result: RaceResult) => void) | undefined;
  const result = new Promise<RaceResult>((resolve) => {
    resultResolve = resolve;
  });
  let postSpawnErrorResolve: ((error: Error) => void) | undefined;
  const postSpawnError = new Promise<Error>((resolve) => {
    postSpawnErrorResolve = resolve;
  });
  child.once('spawn', () => {
    state.spawned = true;
  });
  child.on('message', (message: unknown) => {
    if (!isRecord(message)) return;
    if (message.type === 'ready') {
      state.ready = true;
      state.readyMessage = message;
      readyResolve?.();
    }
    if (isRaceResult(message)) {
      state.result = true;
      resultResolve?.(message);
    }
  });
  child.on('error', (error) => {
    if (!state.spawned && child.pid === undefined && !state.launchError) state.launchError = error;
    else {
      state.postSpawnErrors.push(error);
      postSpawnErrorResolve?.(error);
    }
  });
  let exitRecord: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  child.once('exit', (code, signal) => {
    state.exited = true;
    exitRecord = { code, signal };
  });
  const terminal = new Promise<RaceTerminal>((resolve) => {
    child.once('close', (code, signal) => {
      state.closed = true;
      const close = { code, signal };
      const observed: RaceTerminal =
        state.launchError && !state.spawned
          ? { kind: 'failed-launch', error: state.launchError, close, stderr: state.stderr }
          : exitRecord
            ? { kind: 'exited', exit: exitRecord, close, postSpawnErrors: state.postSpawnErrors, stderr: state.stderr }
            : { kind: 'closed-without-exit', close, postSpawnErrors: state.postSpawnErrors, stderr: state.stderr };
      state.terminal = observed;
      resolve(observed);
    });
  });
  const worker = { child, ready, result, postSpawnError, terminal, state };
  ownedRaceWorkers.add(worker);
  void terminal.then(() => ownedRaceWorkers.delete(worker));
  return worker;
}

async function withRaceTimeout<T>(operation: Promise<T>, label: string, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for race worker ${label}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function terminalError(terminal: RaceTerminal, phase: 'ready' | 'result'): Error {
  if (terminal.kind === 'failed-launch') return terminal.error;
  const status = terminal.kind === 'exited' ? (terminal.exit.code ?? terminal.exit.signal ?? 'unknown') : (terminal.close.code ?? terminal.close.signal ?? 'unknown');
  const error = new Error(`Race worker ${terminal.kind === 'exited' ? 'exited' : 'closed without exit'} before ${phase} (${status}): ${terminal.stderr}`);
  const cause = terminal.postSpawnErrors[0];
  if (cause) (error as Error & { cause?: unknown }).cause = cause;
  return error;
}

function exitBefore(worker: RaceWorker, phase: 'ready' | 'result'): Promise<never> {
  return worker.terminal.then((terminal) => {
    throw terminalError(terminal, phase);
  });
}

function errorBefore(worker: RaceWorker): Promise<never> {
  return worker.postSpawnError.then((error) => {
    throw error;
  });
}

function waitForReady(worker: RaceWorker, timing: RaceTiming): Promise<void> {
  return withRaceTimeout(Promise.race([worker.ready, exitBefore(worker, 'ready'), errorBefore(worker)]), 'ready', timing.phaseMs);
}

function waitForResult(worker: RaceWorker, timing: RaceTiming): Promise<RaceResult> {
  return withRaceTimeout(Promise.race([worker.result, exitBefore(worker, 'result'), errorBefore(worker)]), 'result', timing.phaseMs);
}

function sendGo(worker: RaceWorker, timing: RaceTiming): Promise<void> {
  return withRaceTimeout(
    new Promise((resolve, reject) => {
      if (!worker.child.connected || !worker.child.send) return reject(new Error('Race worker IPC channel closed before send'));
      worker.child.send({ type: 'go' }, (error) => (error ? reject(error) : resolve()));
    }),
    'send',
    timing.phaseMs
  );
}

function serializeProcessError(error: Error): SerializedProcessError {
  const systemError = error as NodeJS.ErrnoException & { path?: string };
  return {
    name: error.name,
    message: error.message,
    ...(systemError.code ? { code: systemError.code } : {}),
    ...(systemError.path ? { path: systemError.path } : {}),
    ...(systemError.syscall ? { syscall: systemError.syscall } : {}),
  };
}

function serializeTerminal(terminal: RaceTerminal): Evidence {
  if (terminal.kind === 'failed-launch') {
    return { kind: terminal.kind, error: serializeProcessError(terminal.error), close: terminal.close, stderr: terminal.stderr };
  }
  return {
    kind: terminal.kind,
    ...(terminal.kind === 'exited' ? { exit: terminal.exit } : {}),
    close: terminal.close,
    postSpawnErrors: terminal.postSpawnErrors.map(serializeProcessError),
    stderr: terminal.stderr,
  };
}

function raceExit(terminal: RaceTerminal): RaceExit {
  if (terminal.kind === 'failed-launch') return { code: terminal.close.code, signal: terminal.close.signal, stderr: terminal.stderr };
  if (terminal.kind === 'closed-without-exit') return { code: terminal.close.code, signal: terminal.close.signal, stderr: terminal.stderr };
  return { code: terminal.exit.code, signal: terminal.exit.signal, stderr: terminal.stderr };
}

function runTaskkill(pid: number, force: boolean): void {
  const result = spawnSync('taskkill.exe', ['/pid', String(pid), '/t', ...(force ? ['/f'] : [])], {
    encoding: 'utf8',
    timeout: 5_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`taskkill exited ${result.status ?? result.signal ?? 'unknown'}: ${result.stderr}`);
}

function terminateProcessTree(worker: RaceWorker, force: boolean): void {
  const pid = worker.child.pid;
  if (pid === undefined || worker.state.terminal) return;
  if (process.platform === 'win32') return runTaskkill(pid, force);
  try {
    process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

async function terminateOne(worker: RaceWorker, timing: RaceTiming): Promise<TerminationOutcome> {
  if (worker.state.terminal) return { terminal: worker.state.terminal, escalated: false };
  let gracefulError: Error | undefined;
  try {
    terminateProcessTree(worker, false);
  } catch (error) {
    gracefulError = error instanceof Error ? error : new Error(String(error));
  }
  try {
    const terminal = await withRaceTimeout(worker.terminal, 'graceful termination', timing.gracefulTerminationMs);
    return { terminal, escalated: false, ...(gracefulError ? { gracefulError } : {}) };
  } catch (gracefulTimeout) {
    let forceError: Error | undefined;
    try {
      terminateProcessTree(worker, true);
    } catch (error) {
      forceError = error instanceof Error ? error : new Error(String(error));
    }
    try {
      const terminal = await withRaceTimeout(worker.terminal, 'forced termination', timing.forceTerminationMs);
      return { terminal, escalated: true, ...(gracefulError ? { gracefulError } : {}), ...(forceError ? { forceError } : {}) };
    } catch (forceTimeout) {
      const error = new Error(`Race worker ${worker.child.pid ?? 'without pid'} remained live after forced termination`) as Error & {
        gracefulTimeout?: unknown;
        gracefulError?: Error;
        forceError?: Error;
        forceTimeout?: unknown;
      };
      error.gracefulTimeout = gracefulTimeout;
      error.forceTimeout = forceTimeout;
      if (gracefulError) error.gracefulError = gracefulError;
      if (forceError) error.forceError = forceError;
      throw error;
    }
  }
}

async function terminateAndAwait(workers: RaceWorker[], timing: RaceTiming): Promise<TerminationOutcome[]> {
  const outcomes = await Promise.allSettled(workers.map((worker) => terminateOne(worker, timing)));
  const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
  if (failures.length > 0) {
    const error = new Error(`Failed to await ${failures.length} terminated race worker(s): ${failures.map(({ reason }) => String(reason)).join('; ')}`) as Error & {
      failures?: unknown[];
    };
    error.failures = failures.map(({ reason }) => reason);
    throw error;
  }
  return outcomes.map((outcome) => {
    if (outcome.status === 'rejected') throw outcome.reason;
    return outcome.value;
  });
}

export interface CompilerCallbackError {
  name: string;
  message: string;
  stack: string;
  details: string;
}

export interface OwnedCompilerResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  callback: { ok: true } | { ok: false; error: CompilerCallbackError };
}

export interface OwnedCompiler {
  wait(): Promise<OwnedCompilerResult>;
  close(): Promise<void>;
  isClosed(): boolean;
}

export function launchOwnedCompiler(cwd: string, timeoutMs: number, options: { postCallbackFatal?: boolean; postCallbackExitFatal?: boolean } = {}): OwnedCompiler {
  const worker = launchRaceWorker('', {
    modulePath: path.join(fixtureRoot, 'test', 'fixtures', 'compiler-callback.mjs'),
    args: options.postCallbackFatal ? ['--post-callback-fatal'] : options.postCallbackExitFatal ? ['--post-callback-exit-fatal'] : [],
    cwd,
  });
  const callbacks: Record<string, unknown>[] = [];
  worker.child.on('message', (message: unknown) => {
    if (isRecord(message) && message.type === 'compiler-callback') callbacks.push(message);
  });
  const timing = { ...defaultRaceTiming, phaseMs: timeoutMs };
  let cleanup: Promise<void> | undefined;
  return {
    async wait() {
      let compilerTerminal: { code: number | null; signal: NodeJS.Signals | null } | undefined;
      try {
        const terminal = await withRaceTimeout(worker.terminal, 'compiler close', timing.phaseMs);
        compilerTerminal = terminal.close;
        if (terminal.kind === 'failed-launch') throw terminal.error;
        if (terminal.postSpawnErrors.length > 0) throw new AggregateError(terminal.postSpawnErrors, 'Compiler process errors');
        if (terminal.kind !== 'exited') throw new Error('Compiler closed without an exit event');
        assert.deepEqual(terminal.exit, terminal.close);
        assert.equal(callbacks.length, 1, `Expected one compiler callback receipt:\n${worker.state.stdout}\n${worker.state.stderr}`);
        const receipt = callbacks[0];
        if (!receipt || typeof receipt.ok !== 'boolean') throw new Error('Invalid compiler callback receipt');
        assert.equal(terminal.close.code, 0, 'Controlled compiler receipt requires normal process completion');
        let callback: OwnedCompilerResult['callback'];
        if (receipt.ok) {
          callback = { ok: true };
        } else {
          const error = receipt.error;
          if (!isRecord(error) || typeof error.name !== 'string' || typeof error.message !== 'string' || typeof error.stack !== 'string' || typeof error.details !== 'string') {
            throw new Error('Invalid compiler callback error receipt');
          }
          callback = { ok: false, error: { name: error.name, message: error.message, stack: error.stack, details: error.details } };
        }
        return { status: terminal.close.code, signal: terminal.close.signal, stdout: worker.state.stdout, stderr: worker.state.stderr, callback };
      } catch (original) {
        if (original instanceof Error) Object.assign(original, { stdout: worker.state.stdout, stderr: worker.state.stderr, compilerCallbacks: callbacks, compilerTerminal });
        throw original;
      }
    },
    close() {
      cleanup ??= Promise.resolve().then(async () => {
        const outcomes = await terminateAndAwait([worker], timing);
        const failures: unknown[] = [];
        for (const outcome of outcomes) {
          if (outcome.gracefulError !== undefined) failures.push(outcome.gracefulError);
          if (outcome.forceError !== undefined) failures.push(outcome.forceError);
        }
        if (!worker.state.closed) failures.push(new Error('Compiler close was not observed'));
        if (failures.length > 0) throw new AggregateError(failures, 'Compiler cleanup failed');
      });
      return cleanup;
    },
    isClosed: () => worker.state.closed,
  };
}

export async function closeOwnedRaceWorkers(): Promise<void> {
  const workers = [...ownedRaceWorkers];
  if (workers.length > 0) await terminateAndAwait(workers, defaultRaceTiming);
}

async function runRaceWorkers(workers: RaceWorker[], timing: RaceTiming = defaultRaceTiming): Promise<{ results: RaceResult[]; exits: RaceExit[] }> {
  try {
    await Promise.all(workers.map((worker) => waitForReady(worker, timing)));
    await Promise.all(workers.map((worker) => sendGo(worker, timing)));
    const results = await Promise.all(workers.map((worker) => waitForResult(worker, timing)));
    const terminals = await Promise.all(workers.map((worker) => withRaceTimeout(worker.terminal, 'exit', timing.phaseMs)));
    assert.ok(terminals.every((terminal) => terminal.kind === 'exited'));
    const exits = terminals.map(raceExit);
    assert.ok(results.every(({ clientClosed }) => clientClosed === true));
    assert.ok(exits.every(({ code, signal }) => code === 0 && signal === null));
    return { results, exits };
  } catch (error) {
    const primaryError = (error instanceof Error ? error : new Error(String(error))) as OwnedProcessError;
    try {
      primaryError.cleanup = await terminateAndAwait(workers, timing);
    } catch (cleanupError) {
      primaryError.cleanupError = cleanupError;
    }
    throw primaryError;
  }
}

export async function mongoEarlyChildFailureEvidence(uri: string): Promise<Evidence> {
  const migrationsDir = await createMigrationDirectory('mongo', 'early-child-failure', ['202609090030_race.js']);
  const workers = [launchRaceWorker({ uri, databaseName: 'gate1_early_child_failure', migrationsDir }), launchRaceWorker('{invalid-json')];
  let failure: OwnedProcessError | undefined;
  try {
    await runRaceWorkers(workers);
  } catch (error) {
    failure = error as OwnedProcessError;
  }
  assert.ok(failure);
  assert.equal(failure.cleanupError, undefined);
  assert.equal(failure.cleanup?.length, workers.length);
  const exits = failure.cleanup?.map(({ terminal }) => raceExit(terminal)) ?? [];
  assert.equal(
    workers.every(({ state }) => state.terminal !== undefined && state.closed),
    true
  );
  assert.ok(exits.some(({ code }) => code !== null && code !== 0));
  return { error: failure.message, allChildrenClosed: true, exits };
}

export async function processSpawnFailureEvidence(): Promise<Evidence> {
  const missingExecPath = path.join(scratchRoot, 'missing-node-executable');
  const worker = launchRaceWorker('{}', { execPath: missingExecPath });
  const timing: RaceTiming = { phaseMs: 1_000, gracefulTerminationMs: 1_000, forceTerminationMs: 1_000 };
  let failure: OwnedProcessError | undefined;
  try {
    await runRaceWorkers([worker], timing);
  } catch (error) {
    failure = error as OwnedProcessError;
  }
  assert.ok(failure);
  assert.equal(failure.cleanupError, undefined);
  const outcome = failure.cleanup?.[0];
  assert.ok(outcome);
  assert.equal(outcome.escalated, false);
  assert.equal(outcome.terminal.kind, 'failed-launch');
  if (outcome.terminal.kind !== 'failed-launch') throw new Error('Expected failed launch terminal state');
  assert.equal(failure, outcome.terminal.error);
  assert.equal((failure as NodeJS.ErrnoException).code, 'ENOENT');
  assert.equal(worker.child.pid, undefined);
  assert.equal(worker.state.exited, false);
  assert.equal(worker.state.closed, true);
  return {
    error: serializeProcessError(failure),
    originalErrorPreserved: failure === outcome.terminal.error,
    pid: worker.child.pid ?? null,
    exitObserved: worker.state.exited,
    terminal: serializeTerminal(outcome.terminal),
  };
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function waitForProcessClosure(pid: number, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (processExists(pid)) {
    if (Date.now() - startedAt >= timeoutMs) throw new Error(`Process ${pid} remained live after process-tree termination`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export async function processForceTerminationEvidence(): Promise<Evidence> {
  const worker = launchRaceWorker('{}', {
    modulePath: path.join(fixtureRoot, 'test', 'fixtures', 'stubborn-process.cjs'),
    args: [],
  });
  const timing: RaceTiming = { phaseMs: 1_000, gracefulTerminationMs: 200, forceTerminationMs: 2_000 };
  let failure: OwnedProcessError | undefined;
  try {
    await runRaceWorkers([worker], timing);
  } catch (error) {
    failure = error as OwnedProcessError;
  }
  assert.ok(failure);
  assert.equal(failure.message, 'Timed out waiting for race worker result');
  assert.equal(failure.cleanupError, undefined);
  const parentPid = worker.child.pid;
  const descendantPid = worker.state.readyMessage?.descendantPid;
  assert.equal(typeof parentPid, 'number');
  assert.equal(typeof descendantPid, 'number');
  const outcome = failure.cleanup?.[0];
  assert.ok(outcome);
  assert.equal(outcome.escalated, true);
  assert.equal(outcome.terminal.kind, 'exited');
  await waitForProcessClosure(descendantPid as number, timing.forceTerminationMs);
  assert.equal(processExists(parentPid as number), false);
  return {
    parentPid,
    descendantPid,
    error: failure.message,
    escalated: outcome.escalated,
    terminal: serializeTerminal(outcome.terminal),
    parentClosed: true,
    descendantClosed: true,
  };
}

export async function mongoRaceEvidence(uri: string, client: MongoClient): Promise<Evidence> {
  const raceFile = '202609090030_race.js';
  const migrationsDir = await createMigrationDirectory('mongo', 'race', [raceFile]);
  const attempts: Evidence[] = [];
  for (let attempt = 1; attempt <= 5; attempt++) {
    const databaseName = `gate1_race_${attempt}`;
    const database = client.db(databaseName);
    const workers = Array.from({ length: 8 }, () => launchRaceWorker({ uri, databaseName, migrationsDir }));
    const { results, exits } = await runRaceWorkers(workers);
    const dataCount = await database.collection('events').countDocuments({ event: 'race-up' });
    const historyCount = await database.collection('changelog').countDocuments({ fileName: raceFile });
    const lockCount = await database.collection('changelog_lock').countDocuments({});
    const observed = {
      attempt,
      successfulWorkers: results.filter(({ ok }) => ok).length,
      failedWorkers: results.filter(({ ok }) => !ok).length,
      workerPids: results.map(({ pid }) => pid),
      clientsClosedBeforeResult: results.every(({ clientClosed }) => clientClosed === true),
      childExits: exits,
      dataCount,
      historyCount,
      lockCount,
    };
    attempts.push(observed);
    if (dataCount > 1 || historyCount > 1) {
      return { reproduced: true, workerCount: workers.length, attempts };
    }
  }
  return { reproduced: false, workerCount: 8, attempts };
}

export async function mongoMissingHistoryEvidence(uri: string, client: MongoClient): Promise<Evidence> {
  const baselineFile = '202609090001_baseline.js';
  const migrationsDir = await createMigrationDirectory('mongo', 'missing', [baselineFile]);
  const database = client.db('gate1_missing_history');
  const runnerConfig = mongoConfig(uri, database.databaseName, migrationsDir);
  migrateMongo.config.set(runnerConfig);
  await migrateMongo.up(database, client);
  await safeRemove(path.join(migrationsDir, baselineFile));
  migrateMongo.config.set(runnerConfig);
  const status = await migrateMongo.status(database);
  const history = await database.collection('changelog').find({}).project({ _id: 0 }).toArray();
  assert.deepEqual(status, []);
  assert.equal(history.length, 1);
  return { status, history };
}

export async function mongoServerEvidence(database: Db): Promise<Evidence> {
  const buildInfo = await database.admin().command({ buildInfo: 1 });
  return { version: buildInfo.version, gitVersion: buildInfo.gitVersion, allocator: buildInfo.allocator };
}
