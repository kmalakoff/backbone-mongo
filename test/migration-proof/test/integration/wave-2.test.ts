// This suite downloads MongoDB 8.2.6 when the worktree-local binary cache is empty.
import assert from 'assert';
import { copyFile, mkdir, mkdtemp, readFile, stat, unlink, writeFile } from 'fs/promises';
import { safeRm } from 'fs-remove-compat';
import type { Knex } from 'knex';
import type { CreateResult, MigrationStatus, SqlPreparationObservation } from 'backbone-mongo-migration-proof';
import { createRequire } from 'module';
import { type Db, MongoClient, ObjectId } from 'mongodb';
import path from 'path';
import { pathToFileURL } from 'url';
import type { MigrationFacade, UpResult } from '../../src/index.ts';
import { MigrationUncertainStateError, MongoHistoryPreflightError } from '../../src/next/errors.ts';
import { closeOwnedMongoProcesses, createIsolatedMongoFacade } from '../../src/next/isolated-mongo.ts';
import type { IsolatedMongoOptions, MongoProcessObservation } from '../../src/next/mongo-protocol.ts';
import { createSqlHistoryFacade, createSqliteDatabase } from '../../src/next/sql-history.ts';
import { buildGeneratedMigration, closeOwnedRaceWorkers, processForceTerminationEvidence } from '../lib/proof.ts';
import { builtMigrationsRoot, builtMongoWorkerPath, callbackOutcome, cleanupWave2Scratch, createWave2MigrationDirectory, fixtureRoot, mongoBinaryCacheRoot, prepareWave2Scratch, wave2EvidenceRoot, wave2IdentityEvidence, wave2ScratchRoot } from '../lib/wave-2.ts';

interface MemoryServer {
  getUri(): string;
  stop(): Promise<boolean>;
}

interface MongoSnapshot {
  data: Record<string, unknown>[];
  history: Record<string, unknown>[];
}

interface BuiltIsolatedMongoModule {
  closeOwnedMongoProcesses(): Promise<void>;
  createIsolatedMongoFacade(options: IsolatedMongoOptions, observe?: (observation: MongoProcessObservation) => void): MigrationFacade;
}

const evidence: Record<string, unknown> = {
  commands: ['nvu 22 npm run validate', 'nvu 22 node test/fixtures/wave-2-process-tree-timeout.mjs'],
  boundary: {
    processIsolationIsNotSingleWriterSafety: true,
    preflightRemainsRaceable: true,
    controlledSingleWriterScope: 'disposable fixtures only',
    nativeLockTtl: 0,
    historyStorage: 'native Knex table and migrate-mongo changelog collection only',
    lockingStrategy: null,
  },
};

let server: MemoryServer | undefined;
let client: MongoClient | undefined;
let uri = '';
const builtProcessClosers = new Set<() => Promise<void>>();
const requireFromTest = createRequire(import.meta.url);

function mongoOptions(databaseName: string, migrationsDir: string, createDir = migrationsDir): IsolatedMongoOptions {
  return { uri, databaseName, migrationsDir, createDir };
}

async function captureError(operation: () => Promise<unknown>): Promise<Error> {
  try {
    await operation();
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error('Expected operation to fail');
}

async function mongoSnapshot(database: Db): Promise<MongoSnapshot> {
  return {
    data: await database.collection('events').find({}).sort({ _id: 1 }).project({ _id: 0 }).toArray(),
    history: await database.collection('changelog').find({}).sort({ _id: 1 }).project({ _id: 0 }).toArray(),
  };
}

function assertClosedProcesses(observations: MongoProcessObservation[]): void {
  assert.ok(observations.length > 0);
  assert.equal(new Set(observations.map(({ pid }) => pid)).size, observations.length);
  assert.equal(
    observations.every(({ operation, pid, clientOpened, clientClosed, exitCode, signal }) => typeof pid === 'number' && clientOpened === (operation !== 'create') && clientClosed && exitCode === 0 && signal === null),
    true
  );
  assert.equal(
    observations.every(({ workerPath }) => workerPath === builtMongoWorkerPath),
    true
  );
}

async function loadBuiltIsolatedMongo(format: 'cjs' | 'esm'): Promise<BuiltIsolatedMongoModule> {
  const modulePath = path.join(fixtureRoot, 'dist', format, 'next', 'isolated-mongo.js');
  const loaded = (format === 'esm' ? await import(pathToFileURL(modulePath).href) : requireFromTest(modulePath)) as BuiltIsolatedMongoModule;
  builtProcessClosers.add(loaded.closeOwnedMongoProcesses);
  return loaded;
}

async function createEventsTable(database: Knex): Promise<void> {
  await database.schema.createTable('events', (table) => {
    table.increments('id').primary();
    table.text('event').notNullable();
  });
}

describe('migration wave 2 isolated history prototype', () => {
  before(async () => {
    await prepareWave2Scratch();
    process.env.MONGOMS_DOWNLOAD_DIR = mongoBinaryCacheRoot;
    process.env.MONGOMS_MD5_CHECK = 'true';
    const databasePath = path.join(wave2ScratchRoot, 'mongo', 'data');
    await mkdir(databasePath, { recursive: true });
    // The cache environment must be set before mongodb-memory-server loads.
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    server = await MongoMemoryServer.create({
      binary: { version: '8.2.6', downloadDir: process.env.MONGOMS_DOWNLOAD_DIR },
      instance: { dbPath: databasePath, storageEngine: 'wiredTiger' },
    });
    uri = server.getUri();
    client = new MongoClient(uri);
    await client.connect();
    const buildInfo = await client.db('admin').admin().command({ buildInfo: 1 });
    evidence.runtime = { ...(await wave2IdentityEvidence()), mongoServer: { version: buildInfo.version, gitVersion: buildInfo.gitVersion } };
  });

  after(async () => {
    await closeOwnedMongoProcesses();
    await Promise.all([...builtProcessClosers].map((close) => close()));
    if (client) await client.close();
    if (server) await server.stop();
    console.log(`WAVE2_EVIDENCE=${JSON.stringify(evidence)}`);
    await writeFile(path.join(wave2EvidenceRoot, 'built-callers-history-diagnostics.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    await cleanupWave2Scratch();
  });

  it('uses one closed ESM process per Mongo operation without A/B configuration cross-talk', async () => {
    assert.ok(client);
    const baselineFile = '202609090001_baseline.js';
    const raceFile = '202609090030_race.js';
    const firstDir = await createWave2MigrationDirectory('mongo', 'isolated-a', [baselineFile]);
    const secondDir = await createWave2MigrationDirectory('mongo', 'isolated-b', [raceFile]);
    const createDir = path.join(wave2ScratchRoot, 'mongo', 'isolated-create');
    await mkdir(createDir, { recursive: true });
    await copyFile(path.join(fixtureRoot, 'test', 'fixtures', 'sample-migration.ts'), path.join(createDir, 'sample-migration.ts'));
    const observations: MongoProcessObservation[] = [];
    const first = createIsolatedMongoFacade(mongoOptions('wave2_isolated_a', firstDir, createDir), (item) => observations.push(item));
    const second = createIsolatedMongoFacade(mongoOptions('wave2_isolated_b', secondDir), (item) => observations.push(item));

    const created = await first.create('wave2_created');
    assert.equal(created.sourceId.replace(/^\d+-/, ''), 'wave2_created.ts');
    const firstPromise = first.up();
    assert.equal(firstPromise instanceof Promise, true);
    const secondCallback = callbackOutcome<UpResult>((callback) => second.up(callback));
    const [firstUp, secondUp] = await Promise.all([firstPromise, secondCallback]);
    assert.deepEqual(firstUp, { applied: [baselineFile] });
    assert.equal(secondUp.error, null);
    assert.deepEqual(secondUp.result, { applied: [raceFile] });
    assert.equal(secondUp.returned, undefined);

    const [firstStatus, secondStatus] = await Promise.all([first.status(), second.status()]);
    assert.deepEqual(
      firstStatus.map(({ id, state }) => ({ id, state })),
      [{ id: baselineFile, state: 'applied' }]
    );
    assert.deepEqual(
      secondStatus.map(({ id, state }) => ({ id, state })),
      [{ id: raceFile, state: 'applied' }]
    );
    const beforeDown = {
      firstWidgets: await client.db('wave2_isolated_a').collection('widgets').countDocuments({ name: 'created' }),
      firstRaceEvents: await client.db('wave2_isolated_a').collection('events').countDocuments({ event: 'race-up' }),
      secondWidgets: await client.db('wave2_isolated_b').collection('widgets').countDocuments({ name: 'created' }),
      secondRaceEvents: await client.db('wave2_isolated_b').collection('events').countDocuments({ event: 'race-up' }),
    };
    assert.deepEqual(beforeDown, { firstWidgets: 1, firstRaceEvents: 0, secondWidgets: 0, secondRaceEvents: 1 });

    const [firstDown, secondDown] = await Promise.all([first.down(), second.down()]);
    assert.deepEqual(firstDown, { reverted: [baselineFile] });
    assert.deepEqual(secondDown, { reverted: [raceFile] });
    assert.equal(await client.db('wave2_isolated_a').collection('changelog').countDocuments({}), 0);
    assert.equal(await client.db('wave2_isolated_b').collection('changelog').countDocuments({}), 0);
    assert.equal(await client.db('wave2_isolated_b').collection('events').countDocuments({ event: 'race-up' }), 0);
    assertClosedProcesses(observations);
    evidence.isolation = { created, firstUp, secondUp: secondUp.result, firstStatus, secondStatus, beforeDown, firstDown, secondDown, observations };
  });

  it('runs real Mongo operations from the actual built ESM and CJS callers', async () => {
    assert.ok(client);
    const baselineFile = '202609090001_baseline.js';
    const results: Record<string, unknown> = {};

    for (const format of ['esm', 'cjs'] as const) {
      const migrationsDir = await createWave2MigrationDirectory('mongo', `built-${format}`, [baselineFile]);
      const databaseName = `wave2_built_${format}`;
      const observations: MongoProcessObservation[] = [];
      const builtModule = await loadBuiltIsolatedMongo(format);
      const facade = builtModule.createIsolatedMongoFacade(mongoOptions(databaseName, migrationsDir), (observation) => observations.push(observation));
      const up = await facade.up();
      const status = await facade.status();
      const widgetCount = await client.db(databaseName).collection('widgets').countDocuments({ name: 'created' });
      const history = await client.db(databaseName).collection('changelog').find({}).project({ _id: 0, fileName: 1 }).toArray();
      const down = await facade.down();

      assert.deepEqual(up, { applied: [baselineFile] });
      assert.deepEqual(
        status.map(({ id, state }) => ({ id, state })),
        [{ id: baselineFile, state: 'applied' }]
      );
      assert.equal(widgetCount, 1);
      assert.deepEqual(history, [{ fileName: baselineFile }]);
      assert.deepEqual(down, { reverted: [baselineFile] });
      assert.equal(await client.db(databaseName).collection('changelog').countDocuments({}), 0);
      assertClosedProcesses(observations);
      results[format] = { callerPath: path.join(fixtureRoot, 'dist', format, 'next', 'isolated-mongo.js'), up, status, widgetCount, history, down, observations };
    }

    evidence.builtCallers = { workerPath: builtMongoWorkerPath, results };
  });

  it('rejects unsafe raw Mongo histories before changing data or changelog', async () => {
    assert.ok(client);
    const baselineFile = '202609090001_baseline.js';
    const backdatedFile = '202609090005_order_backdated.js';
    const newFile = '202609090010_order_new.js';
    const observations: MongoProcessObservation[] = [];

    const missingDir = await createWave2MigrationDirectory('mongo', 'preflight-missing', [baselineFile]);
    const missingFacade = createIsolatedMongoFacade(mongoOptions('wave2_preflight_missing', missingDir), (item) => observations.push(item));
    await missingFacade.up();
    await unlink(path.join(missingDir, baselineFile));
    const missingBefore = {
      widgetCount: await client.db('wave2_preflight_missing').collection('widgets').countDocuments({}),
      history: await client.db('wave2_preflight_missing').collection('changelog').find({}).project({ _id: 0 }).toArray(),
    };
    const missingError = await captureError(() => missingFacade.up());
    assert.ok(missingError instanceof MongoHistoryPreflightError);
    assert.equal(missingError.code, 'missing-applied-files');
    assert.deepEqual(missingError.ids, [baselineFile]);
    assert.deepEqual(
      {
        widgetCount: await client.db('wave2_preflight_missing').collection('widgets').countDocuments({}),
        history: await client.db('wave2_preflight_missing').collection('changelog').find({}).project({ _id: 0 }).toArray(),
      },
      missingBefore
    );

    const backdatedDir = await createWave2MigrationDirectory('mongo', 'preflight-backdated', [newFile]);
    const backdatedFacade = createIsolatedMongoFacade(mongoOptions('wave2_preflight_backdated', backdatedDir), (item) => observations.push(item));
    await backdatedFacade.up();
    await copyFile(path.join(builtMigrationsRoot, 'mongo', backdatedFile), path.join(backdatedDir, backdatedFile));
    const backdatedBefore = await mongoSnapshot(client.db('wave2_preflight_backdated'));
    const backdatedError = await captureError(() => backdatedFacade.up());
    assert.ok(backdatedError instanceof MongoHistoryPreflightError);
    assert.equal(backdatedError.code, 'backdated-pending-files');
    assert.deepEqual(backdatedError.ids, [backdatedFile]);
    assert.deepEqual(await mongoSnapshot(client.db('wave2_preflight_backdated')), backdatedBefore);

    const unsupportedDir = await createWave2MigrationDirectory('mongo', 'preflight-unsupported-down', [backdatedFile, newFile]);
    const unsupportedDatabase = client.db('wave2_preflight_unsupported_down');
    await unsupportedDatabase.collection('events').insertMany([{ event: 'new-up' }, { event: 'backdated-up' }]);
    await unsupportedDatabase.collection('changelog').insertMany([
      { _id: new ObjectId(), fileName: newFile, appliedAt: new Date('2026-09-10T00:00:00.000Z'), migrationBlock: 1 },
      { _id: new ObjectId(), fileName: backdatedFile, appliedAt: new Date('2026-09-10T00:00:01.000Z'), migrationBlock: 2 },
    ]);
    const unsupportedFacade = createIsolatedMongoFacade(mongoOptions(unsupportedDatabase.databaseName, unsupportedDir), (item) => observations.push(item));
    const unsupportedBefore = await mongoSnapshot(unsupportedDatabase);
    const unsupportedError = await captureError(() => unsupportedFacade.down());
    assert.ok(unsupportedError instanceof MongoHistoryPreflightError);
    assert.equal(unsupportedError.code, 'unsupported-history-order');
    assert.deepEqual(unsupportedError.ids, [newFile, backdatedFile]);
    assert.deepEqual(await mongoSnapshot(unsupportedDatabase), unsupportedBefore);
    assertClosedProcesses(observations);
    evidence.mongoPreflight = {
      missing: { code: missingError.code, ids: missingError.ids, before: missingBefore },
      backdated: { code: backdatedError.code, ids: backdatedError.ids, before: backdatedBefore },
      unsupportedDown: { code: unsupportedError.code, ids: unsupportedError.ids, before: unsupportedBefore },
      observations,
    };
  });

  it('passes the recorded application-last SQL name to native Knex down', async () => {
    const newFile = '202609090010_order_new.js';
    const backdatedFile = '202609090005_order_backdated.js';
    const migrationsDir = await createWave2MigrationDirectory('sql', 'application-last-down', [newFile]);
    const database = createSqliteDatabase(path.join(wave2ScratchRoot, 'sql', 'application-last-down.sqlite'));
    try {
      await createEventsTable(database);
      const facade = createSqlHistoryFacade(database, migrationsDir, migrationsDir);
      await facade.up();
      await copyFile(path.join(builtMigrationsRoot, 'sql', backdatedFile), path.join(migrationsDir, backdatedFile));
      await facade.up();
      const historyBefore = await database('knex_migrations').orderBy('id').select('id', 'name');
      assert.deepEqual(
        historyBefore.map(({ name }) => name),
        [newFile, backdatedFile]
      );
      const down = await facade.down();
      const events = await database('events').orderBy('id').select('event');
      const historyAfter = await database('knex_migrations').orderBy('id').select('name');
      assert.deepEqual(down, { reverted: [backdatedFile] });
      assert.deepEqual(events, [{ event: 'new-up' }, { event: 'backdated-up' }, { event: 'backdated-down' }]);
      assert.deepEqual(historyAfter, [{ name: newFile }]);
      evidence.sqlApplicationLastDown = { historyBefore, down, events, historyAfter };
    } finally {
      await database.destroy();
    }
  });

  it('reports post-write failure as uncertain with causes and known completed IDs without retry', async () => {
    assert.ok(client);
    const baselineFile = '202609090001_baseline.js';
    const newFile = '202609090010_order_new.js';
    const failureFile = '202609090020_failure.js';
    const sqlDir = await createWave2MigrationDirectory('sql', 'uncertain', [newFile, failureFile]);
    const sqlDatabase = createSqliteDatabase(path.join(wave2ScratchRoot, 'sql', 'uncertain.sqlite'));
    let sqlEvidence: Record<string, unknown>;
    try {
      await createEventsTable(sqlDatabase);
      const sqlFacade = createSqlHistoryFacade(sqlDatabase, sqlDir, sqlDir);
      const sqlError = await captureError(() => sqlFacade.up());
      assert.ok(sqlError instanceof MigrationUncertainStateError);
      assert.equal(sqlError.operation, 'up');
      assert.deepEqual(sqlError.completedIds, [newFile]);
      assert.equal(sqlError.historyInspected, true);
      assert.equal((sqlError.cause as Error).message, 'failure after SQL data change');
      const sqlData = await sqlDatabase('events').orderBy('id').select('event');
      const sqlHistory = await sqlDatabase('knex_migrations').orderBy('id').select('name');
      assert.deepEqual(sqlData, [{ event: 'new-up' }, { event: 'failure-write' }]);
      assert.deepEqual(sqlHistory, [{ name: newFile }]);
      sqlEvidence = { message: sqlError.message, cause: (sqlError.cause as Error).message, completedIds: sqlError.completedIds, data: sqlData, history: sqlHistory };
    } finally {
      await sqlDatabase.destroy();
    }

    const promiseDir = await createWave2MigrationDirectory('mongo', 'uncertain-promise', [baselineFile, failureFile]);
    const callbackDir = await createWave2MigrationDirectory('mongo', 'uncertain-callback', [baselineFile, failureFile]);
    const observations: MongoProcessObservation[] = [];
    const promiseFacade = createIsolatedMongoFacade(mongoOptions('wave2_uncertain_promise', promiseDir), (item) => observations.push(item));
    const callbackFacade = createIsolatedMongoFacade(mongoOptions('wave2_uncertain_callback', callbackDir), (item) => observations.push(item));
    const promiseErrorResult = captureError(() => promiseFacade.up());
    const callbackErrorResult = callbackOutcome<UpResult>((callback) => callbackFacade.up(callback));
    const [promiseError, callbackError] = await Promise.all([promiseErrorResult, callbackErrorResult]);
    assert.ok(promiseError instanceof MigrationUncertainStateError);
    assert.ok(callbackError.error instanceof MigrationUncertainStateError);
    assert.equal(callbackError.result, undefined);
    assert.equal(callbackError.returned, undefined);
    for (const error of [promiseError, callbackError.error]) {
      assert.equal(error.operation, 'up');
      assert.deepEqual(error.completedIds, [baselineFile]);
      assert.equal(error.historyInspected, true);
      assert.equal(error.cause.historyInspectionError, undefined);
      assert.equal((error.cause as Error).message, `Could not migrate up ${failureFile}: failure after Mongo data change`);
    }
    const promiseState = await mongoSnapshot(client.db('wave2_uncertain_promise'));
    const callbackState = await mongoSnapshot(client.db('wave2_uncertain_callback'));
    assert.equal(promiseState.data.filter(({ event }) => event === 'failure-write').length, 1);
    assert.deepEqual(callbackState.data, promiseState.data);
    assert.deepEqual(
      callbackState.history.map(({ fileName }) => fileName),
      promiseState.history.map(({ fileName }) => fileName)
    );
    assert.deepEqual(
      promiseState.history.map(({ fileName }) => fileName),
      [baselineFile]
    );
    assertClosedProcesses(observations);
    evidence.uncertainState = {
      sql: sqlEvidence,
      mongo: {
        promise: { message: promiseError.message, cause: (promiseError.cause as Error).message, completedIds: promiseError.completedIds },
        callback: { calls: callbackError.calls, resultProvided: callbackError.result !== undefined, message: callbackError.error.message, cause: callbackError.error.cause.message, completedIds: callbackError.error.completedIds },
        promiseState,
        callbackState,
        observations,
      },
      automaticRetry: false,
    };
  });

  it('retains runner completions and typed diagnostics when post-failure history inspection is unavailable', async () => {
    assert.ok(client);
    const baselineFile = '202609090001_baseline.js';
    const failureFile = '202609090025_history_unavailable.js';
    const migrationsDir = await createWave2MigrationDirectory('mongo', 'history-unavailable', [baselineFile, failureFile]);
    const observations: MongoProcessObservation[] = [];
    const facade = createIsolatedMongoFacade(mongoOptions('wave2_history_unavailable', migrationsDir), (observation) => observations.push(observation));

    const error = await captureError(() => facade.up());
    assert.ok(error instanceof MigrationUncertainStateError);
    assert.equal(error.operation, 'up');
    assert.equal(error.historyInspected, false);
    assert.deepEqual(error.completedIds, [baselineFile]);
    assert.deepEqual(error.cause.migrated, [baselineFile]);
    assert.equal(error.cause.message, `Could not migrate up ${failureFile}: failure after closing the migration client`);
    assert.ok(error.cause.historyInspectionError instanceof Error);
    assert.equal(error.cause.historyInspectionError.message.length > 0, true);

    const state = await mongoSnapshot(client.db('wave2_history_unavailable'));
    assert.equal(state.data.filter(({ event }) => event === 'history-unavailable-write').length, 1);
    assert.deepEqual(
      state.history.map(({ fileName }) => fileName),
      [baselineFile]
    );
    assertClosedProcesses(observations);
    evidence.unavailableHistoryInspection = {
      message: error.message,
      cause: { name: error.cause.name, message: error.cause.message, migrated: error.cause.migrated, historyInspectionError: { name: error.cause.historyInspectionError.name, message: error.cause.historyInspectionError.message } },
      historyInspected: error.historyInspected,
      completedIds: error.completedIds,
      state,
      observations,
      automaticRetry: false,
    };
  });
});

describe('migration create/status preparation', () => {
  let root = '';
  let memory: MemoryServer | undefined;
  let native: MongoClient | undefined;
  let targetUri = '';
  let cleanupCompletion: Promise<void> | undefined;
  const sqlOracles = new Set<Knex>();
  const preparationClosers = new Set<() => Promise<void>>();
  const environment = new Map<string, string | undefined>();
  const baselineId = '202609090001_baseline.js';
  const pendingId = '202609090010_order_new.js';

  function cleanup(): Promise<void> {
    cleanupCompletion ??= Promise.resolve().then(async () => {
      const failures: unknown[] = [];
      async function settle(action: () => Promise<unknown>): Promise<void> {
        try { await action(); } catch (error) { failures.push(error); }
      }
      await settle(closeOwnedRaceWorkers);
      await settle(closeOwnedMongoProcesses);
      for (const close of preparationClosers) await settle(close);
      for (const database of sqlOracles) await settle(async () => {
        await database.destroy();
        assert.equal(database.client.pool, undefined);
      });
      const acquiredNative = native;
      const acquiredMemory = memory;
      if (acquiredNative) await settle(() => acquiredNative.close());
      if (acquiredMemory) await settle(async () => { assert.equal(await acquiredMemory.stop(), true); });
      for (const [key, value] of environment) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      if (failures.length > 0) throw new AggregateError(failures, 'Preparation fixture cleanup failed');
      if (root) await new Promise<void>((resolve, reject) => safeRm(root, (error) => error ? reject(error) : resolve()));
    });
    return cleanupCompletion;
  }

  async function directory(backend: 'sql' | 'mongo', label: string): Promise<string> {
    const destination = path.join(root, backend, label, 'deployed');
    await mkdir(destination, { recursive: true });
    for (const id of [baselineId, pendingId]) {
      const body = await readFile(path.join(builtMigrationsRoot, backend, id), 'utf8');
      await writeFile(path.join(destination, id), `throw new Error('Migration import is forbidden during create/status');\n${body}`);
    }
    await writeFile(path.join(destination, 'sample-migration.js'), "throw new Error('Sample import is forbidden');\n");
    await writeFile(path.join(destination, 'ignored.ts'), "throw new Error('TypeScript source is not deployed');\n");
    return destination;
  }

  async function owners(format: 'esm' | 'cjs'): Promise<typeof import('backbone-mongo-migration-proof')> {
    const ownedModule = await loadBuiltIsolatedMongo(format);
    preparationClosers.add(ownedModule.closeOwnedMongoProcesses);
    return format === 'esm' ? import('backbone-mongo-migration-proof') : requireFromTest('backbone-mongo-migration-proof');
  }

  function assertReadCommands(observations: MongoProcessObservation[]): void {
    assert.ok(observations.length > 0);
    for (const observation of observations) {
      assert.equal(observation.clientOpened, observation.operation === 'status');
      assert.equal(observation.clientClosed, true);
      assert.equal(observation.exitCode, 0);
      assert.equal(observation.signal, null);
      assert.ok(observation.pid);
      assert.equal(observation.workerPath, builtMongoWorkerPath);
      assert.equal(observation.commandNames.every((name) => ['find', 'getMore', 'killCursors', 'endSessions'].includes(name)), true);
      if (observation.operation === 'create') assert.deepEqual(observation.commandNames, []);
    }
  }

  before(async () => {
    try {
      root = await mkdtemp(path.join(path.dirname(wave2ScratchRoot), 'migration-create-status-'));
      for (const key of ['MONGOMS_DOWNLOAD_DIR', 'MONGOMS_MD5_CHECK', 'MONGOMS_RUNTIME_DOWNLOAD']) environment.set(key, process.env[key]);
      process.env.MONGOMS_DOWNLOAD_DIR = mongoBinaryCacheRoot;
      process.env.MONGOMS_MD5_CHECK = 'true';
      process.env.MONGOMS_RUNTIME_DOWNLOAD = 'false';
      const dbPath = path.join(root, 'native');
      await mkdir(dbPath, { recursive: true });
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      memory = await MongoMemoryServer.create({ binary: { version: '8.2.6', downloadDir: mongoBinaryCacheRoot }, instance: { dbPath, ip: '127.0.0.1', storageEngine: 'wiredTiger' } });
      targetUri = memory.getUri();
      native = new MongoClient(targetUri);
      await native.connect();
    } catch (original) {
      try { await cleanup(); } catch (failure) { throw new AggregateError([original, failure], 'Preparation startup and cleanup failed'); }
      throw original;
    }
  });

  after(cleanup);

  for (const format of ['esm', 'cjs'] as const) {
    it(`${format} SQL create uses the typed Knex template without opening a database`, async () => {
      const api = await owners(format);
      const cwd = process.cwd();
      const filename = path.join(root, `offline-${format}.sqlite`);
      const createDir = path.join(root, 'sql', `create-${format}`);
      const observations: SqlPreparationObservation[] = [];
      const facade = api.createSqlPreparationFacade({ database: { client: 'sqlite3', connection: { filename }, useNullAsDefault: true }, migrationsDir: createDir, createDir }, (entry) => observations.push(entry));
      assert.equal('up' in facade, false);
      assert.equal('down' in facade, false);
      assert.deepEqual(observations, []);
      const created = await facade.create('promise_template');
      const callback = await callbackOutcome<CreateResult>((done) => facade.create('callback_template', done));
      assert.equal(callback.error, null);
      assert.ok(callback.result);
      assert.equal(created.deployedId, created.sourceId.replace(/\.ts$/, '.js'));
      assert.equal(callback.result.deployedId, callback.result.sourceId.replace(/\.ts$/, '.js'));
      assert.match(await readFile(path.join(createDir, created.sourceId), 'utf8'), /import type \{ Knex \}/);
      await assert.rejects(stat(filename), (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
      const promiseError = await captureError(() => facade.create(''));
      const callbackError = await callbackOutcome<CreateResult>((done) => facade.create('', done));
      assert.ok(callbackError.error);
      assert.equal(callbackError.error.name, promiseError.name);
      assert.equal(callbackError.error.message, promiseError.message);
      assert.equal(callbackError.result, undefined);
      assert.equal(observations.length, 4);
      assert.equal(observations.every(({ poolClosed, queries }) => poolClosed && queries.length === 0), true);
      assert.equal(process.cwd(), cwd);
    });

    it(`${format} Mongo create has no client and preserves native filesystem errors`, async () => {
      const api = await owners(format);
      const createDir = path.join(root, 'mongo', `create-${format}`);
      await mkdir(createDir, { recursive: true });
      await copyFile(path.join(fixtureRoot, 'test', 'fixtures', 'sample-migration.ts'), path.join(createDir, 'sample-migration.ts'));
      const observations: MongoProcessObservation[] = [];
      const options = { uri: 'invalid-uri-create-must-not-parse', databaseName: 'never_opened', migrationsDir: createDir, createDir };
      const facade = api.createMongoPreparationFacade(options, (entry) => observations.push(entry));
      assert.equal('up' in facade, false);
      assert.equal('down' in facade, false);
      assert.deepEqual(observations, []);
      const cwd = process.cwd();
      const created = await facade.create('promise_template');
      const callback = await callbackOutcome<CreateResult>((done) => facade.create('callback_template', done));
      assert.equal(callback.error, null);
      assert.ok(callback.result);
      assert.equal(created.deployedId, created.sourceId.replace(/\.ts$/, '.js'));
      assert.match(await readFile(path.join(createDir, created.sourceId), 'utf8'), /import type \{ Db, MongoClient \}/);
      await unlink(path.join(createDir, 'sample-migration.ts'));
      const promiseError = await captureError(() => facade.create('missing_template'));
      const callbackError = await callbackOutcome<CreateResult>((done) => facade.create('missing_template', done));
      assert.ok(callbackError.error);
      assert.equal(callbackError.error.name, promiseError.name);
      assert.equal(callbackError.error.message, promiseError.message);
      assert.ok('code' in promiseError);
      assert.equal(promiseError.code, 'ENOENT');
      assert.ok('code' in callbackError.error);
      assert.equal(callbackError.error.code, promiseError.code);
      assert.equal(callbackError.result, undefined);
      assert.equal(observations.length, 4);
      assertReadCommands(observations);
      assert.equal(process.cwd(), cwd);
    });

    it(`${format} SQL status reads native history without initialization, import or writes`, async () => {
      const api = await owners(format);
      const migrationsDir = await directory('sql', `status-${format}`);
      const filename = path.join(root, `status-${format}.sqlite`);
      const oracle = createSqliteDatabase(filename);
      sqlOracles.add(oracle);
      await oracle.raw('select 1');
      const observations: SqlPreparationObservation[] = [];
      const facade = api.createSqlPreparationFacade({ database: { client: 'sqlite3', connection: { filename }, useNullAsDefault: true, migrations: { tableName: 'native_preparation_history' } }, migrationsDir, createDir: migrationsDir }, (entry) => observations.push(entry));
      const schemaBefore = await oracle('sqlite_master').orderBy('name').select('name', 'type', 'sql');
      const pending = await facade.status();
      assert.deepEqual(pending, [baselineId, pendingId, 'sample-migration.js'].map((id) => ({ id, state: 'pending' })));
      assert.deepEqual(await oracle('sqlite_master').orderBy('name').select('name', 'type', 'sql'), schemaBefore);
      await oracle.schema.createTable('native_preparation_history', (table) => {
        table.increments('id');
        table.string('name');
        table.integer('batch');
        table.timestamp('migration_time');
      });
      const appliedAt = '2026-09-10T00:00:00.000Z';
      await oracle('native_preparation_history').insert({ name: baselineId, batch: 1, migration_time: appliedAt });
      const before = await oracle('native_preparation_history').orderBy('id').select('*');
      const callback = await callbackOutcome<MigrationStatus[]>((done) => facade.status(done));
      assert.equal(callback.error, null);
      assert.deepEqual(callback.result, [{ id: baselineId, state: 'applied', appliedAt }, { id: pendingId, state: 'pending' }, { id: 'sample-migration.js', state: 'pending' }]);
      const body = await readFile(path.join(migrationsDir, baselineId));
      await unlink(path.join(migrationsDir, baselineId));
      const failure = await captureError(() => facade.status());
      const callbackFailure = await callbackOutcome<MigrationStatus[]>((done) => facade.status(done));
      assert.ok(callbackFailure.error);
      assert.equal(callbackFailure.error.message, failure.message);
      assert.match(failure.message, /missing-applied-files/);
      assert.equal(callbackFailure.result, undefined);
      assert.deepEqual(await oracle('native_preparation_history').orderBy('id').select('*'), before);
      await writeFile(path.join(migrationsDir, baselineId), body);
      await oracle('native_preparation_history').insert({ name: baselineId, batch: 2, migration_time: appliedAt });
      const duplicated = await oracle('native_preparation_history').orderBy('id').select('*');
      await assert.rejects(facade.status(), /duplicate-history/);
      assert.deepEqual(await oracle('native_preparation_history').orderBy('id').select('*'), duplicated);
      assert.equal(await oracle.schema.hasTable('knex_migrations'), false);
      assert.equal(await oracle.schema.hasTable('native_preparation_history_lock'), false);
      assert.ok(observations.length >= 5);
      assert.equal(observations.every(({ poolClosed, queries }) => poolClosed && queries.length > 0 && queries.every((sql) => /^\s*select\b/i.test(sql))), true);
    });

    it(`${format} Mongo status preserves native history and closes every read-only worker`, async () => {
      assert.ok(native);
      const api = await owners(format);
      const migrationsDir = await directory('mongo', `status-${format}`);
      const database = native.db(`preparation_status_${format}_${process.pid}`);
      const observations: MongoProcessObservation[] = [];
      const facade = api.createMongoPreparationFacade({ uri: targetUri, databaseName: database.databaseName, migrationsDir, createDir: migrationsDir }, (entry) => observations.push(entry));
      const snapshot = async () => ({
        history: await database.collection('changelog').find({}).sort({ _id: 1 }).toArray(),
        events: await database.collection('events').find({}).sort({ _id: 1 }).toArray(),
        collections: await database.listCollections({}, { nameOnly: true }).toArray(),
      });
      const empty = await snapshot();
      assert.deepEqual(await facade.status(), [baselineId, pendingId].map((id) => ({ id, state: 'pending' })));
      assert.deepEqual(await snapshot(), empty);
      const appliedAt = '2026-09-10T00:00:00.000Z';
      await database.collection('changelog').insertOne({ fileName: baselineId, migrationBlock: 1, appliedAt: new Date(appliedAt) });
      await database.collection('events').insertOne({ event: 'survivor' });
      const before = await snapshot();
      const callback = await callbackOutcome<MigrationStatus[]>((done) => facade.status(done));
      assert.equal(callback.error, null);
      assert.deepEqual(callback.result, [{ id: baselineId, state: 'applied', appliedAt }, { id: pendingId, state: 'pending' }]);
      assert.deepEqual(await snapshot(), before);
      const body = await readFile(path.join(migrationsDir, baselineId));
      await unlink(path.join(migrationsDir, baselineId));
      const failure = await captureError(() => facade.status());
      const callbackFailure = await callbackOutcome<MigrationStatus[]>((done) => facade.status(done));
      assert.equal(failure.name, 'MongoHistoryPreflightError');
      assert.ok(callbackFailure.error instanceof Error);
      assert.equal(callbackFailure.error.name, failure.name);
      assert.ok('operation' in failure);
      assert.equal(failure.operation, 'status');
      assert.ok('code' in failure);
      assert.equal(failure.code, 'missing-applied-files');
      assert.ok('ids' in failure);
      assert.deepEqual(failure.ids, [baselineId]);
      assert.equal(callbackFailure.error.message, failure.message);
      assert.ok('ids' in callbackFailure.error);
      assert.deepEqual(callbackFailure.error.ids, failure.ids);
      assert.equal(callbackFailure.result, undefined);
      assert.deepEqual(await snapshot(), before);
      await writeFile(path.join(migrationsDir, baselineId), body);
      await database.collection('changelog').insertOne({ fileName: baselineId, migrationBlock: 2, appliedAt: new Date(appliedAt) });
      const duplicated = await snapshot();
      await assert.rejects(facade.status(), (error: unknown) => error instanceof Error && error.name === 'MongoHistoryPreflightError' && 'code' in error && error.code === 'duplicate-history');
      assert.deepEqual(await snapshot(), duplicated);
      assert.equal(observations.length, 5);
      assertReadCommands(observations);
    });

    it(`${format} SQL preparation rejects unadmitted configuration before acquisition`, async () => {
      const api = await owners(format);
      const migrationsDir = await directory('sql', `admission-${format}`);
      await writeFile(path.join(migrationsDir, 'unsupported.mjs'), "throw new Error('Unadmitted loader must not import');\n");
      const filename = path.join(root, `admission-missing-${format}.sqlite`);
      const connection = { filename };
      const observations: SqlPreparationObservation[] = [];
      let providerCalls = 0;
      const unsupported: unknown[] = [
        { client: 'sqlite', connection },
        { dialect: 'sqlite3', connection },
        { client: 'sqlite3', connection: `sqlite://${filename}` },
        { client: 'sqlite3', connection: () => { providerCalls++; return connection; } },
        { client: 'sqlite3', connectionPool: {}, connection },
        { client: 'sqlite3', connection, pool: { afterCreate() { providerCalls++; } } },
        { client: 'sqlite3', connection: { ...connection, flags: ['OPEN_CREATE'] } },
        { client: 'sqlite3', connection, migrations: { loadExtensions: ['.mjs'] } },
        { client: 'sqlite3', connection, migrations: { directory: [migrationsDir] } },
        { client: 'sqlite3', connection, migrations: { migrationSource: {} } },
        { client: 'sqlite3', connection, migrations: { extension: 'mjs' } },
        { client: 'sqlite3', connection, migrations: { sortDirsSeparately: true } },
        { client: 'pg', connection: { database: 'unadmitted' } },
      ];
      for (const database of unsupported) {
        assert.throws(() => Reflect.apply(api.createSqlPreparationFacade, undefined, [{ database, migrationsDir, createDir: migrationsDir }, (entry: SqlPreparationObservation) => observations.push(entry)]), /preparation/i);
        await assert.rejects(stat(filename), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT');
      }
      assert.equal(providerCalls, 0);
      const admitted = api.createSqlPreparationFacade({ database: { client: 'sqlite3', connection }, migrationsDir, createDir: migrationsDir }, (entry) => observations.push(entry));
      await assert.rejects(admitted.status(), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT');
      const callback = await callbackOutcome<MigrationStatus[]>((done) => admitted.status(done));
      assert.ok(callback.error);
      assert.ok('code' in callback.error);
      assert.equal(callback.error.code, 'ENOENT');
      const memoryFacade = api.createSqlPreparationFacade({ database: { client: 'sqlite3', connection: { filename: ':memory:' } }, migrationsDir, createDir: migrationsDir }, (entry) => observations.push(entry));
      await assert.rejects(memoryFacade.status(), /existing SQLite file/);
      assert.deepEqual(observations, []);
      await assert.rejects(stat(filename), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT');
      assert.ok((await readFile(path.join(migrationsDir, 'unsupported.mjs'), 'utf8')).includes('Unadmitted loader'));
    });

    it(`${format} SQL status matches independently prepared native list and frozen survivors`, async () => {
      const api = await owners(format);
      const migrationsDir = await directory('sql', `native-parity-${format}`);
      const filename = path.join(root, `native-parity-${format}.sqlite`);
      const oracle = createSqliteDatabase(filename);
      sqlOracles.add(oracle);
      const tableName = `native_parity_${format}`;
      const metadata = { directory: migrationsDir, loadExtensions: ['.js'], tableName, schemaName: 'main' };
      const [initialApplied, initialPending] = await oracle.migrate.list(metadata);
      assert.deepEqual(initialApplied, []);
      const pendingIds = initialPending.map((entry: unknown) => {
        assert.ok(entry && typeof entry === 'object' && 'file' in entry && typeof entry.file === 'string');
        return entry.file;
      });
      assert.deepEqual(pendingIds, [baselineId, pendingId, 'sample-migration.js']);
      const appliedAt = '2026-09-10T00:00:00.000Z';
      await oracle(tableName).insert({ name: baselineId, batch: 1, migration_time: appliedAt });
      await oracle.schema.createTable('preparation_survivors', (table) => {
        table.increments('id');
        table.string('value');
      });
      await oracle('preparation_survivors').insert({ value: 'native survivor' });
      const [nativeApplied, nativePending] = await oracle.migrate.list(metadata);
      const nativeAppliedIds = nativeApplied.map((entry: unknown) => {
        assert.ok(entry && typeof entry === 'object' && 'name' in entry && typeof entry.name === 'string');
        return entry.name;
      });
      const nativePendingIds: string[] = nativePending.map((entry: unknown): string => {
        assert.ok(entry && typeof entry === 'object' && 'file' in entry && typeof entry.file === 'string');
        return entry.file;
      });
      const snapshot = async () => ({
        schema: await oracle('sqlite_master').orderBy('name').select('name', 'type', 'sql'),
        history: await oracle(tableName).orderBy('id').select('*'),
        locks: await oracle(`${tableName}_lock`).orderBy('index').select('*'),
        survivors: await oracle('preparation_survivors').orderBy('id').select('*'),
      });
      const before = await snapshot();
      const observations: SqlPreparationObservation[] = [];
      const facade = api.createSqlPreparationFacade({ database: { client: 'sqlite3', connection: { filename }, migrations: { tableName, schemaName: 'main' } }, migrationsDir, createDir: migrationsDir }, (entry) => observations.push(entry));
      const status = await facade.status();
      assert.deepEqual(status, [{ id: baselineId, state: 'applied', appliedAt }, ...nativePendingIds.map((id) => ({ id, state: 'pending' }))]);
      assert.deepEqual(status.filter(({ state }) => state === 'applied').map(({ id }) => id), nativeAppliedIds);
      assert.deepEqual(await snapshot(), before);
      const callback = await callbackOutcome<MigrationStatus[]>((done) => facade.status(done));
      assert.equal(callback.error, null);
      assert.deepEqual(callback.result, status);
      assert.deepEqual(await snapshot(), before);
      assert.equal(observations.length, 2);
      assert.equal(observations.every(({ poolClosed, queries }) => poolClosed && queries.length > 0 && queries.every((sql) => /^\s*select\b/i.test(sql))), true);
      assert.deepEqual(before.survivors.map(({ value }) => value), ['native survivor']);
    });

    it(`${format} Mongo operation and observer failures remain together after owned close`, async () => {
      assert.ok(native);
      const api = await owners(format);
      const observations: MongoProcessObservation[] = [];
      for (const operation of ['create', 'status'] as const) {
        const migrationsDir = await directory('mongo', `observer-${format}-${operation}`);
        const database = native.db(`preparation_observer_${format}_${operation}_${process.pid}`);
        await database.collection('changelog').insertOne({ fileName: 'missing-applied.js', migrationBlock: 1, appliedAt: new Date('2026-09-10T00:00:00.000Z') });
        const before = await database.collection('changelog').find({}).toArray();
        const observerFailure = operation === 'create' ? new Error('original observer failure') : false;
        const facade = api.createMongoPreparationFacade({ uri: targetUri, databaseName: database.databaseName, migrationsDir, createDir: migrationsDir }, (entry) => {
          observations.push(entry);
          throw observerFailure;
        });
        const start = () => operation === 'create' ? facade.create('missing_sample') : facade.status();
        const promiseFailure = await captureError(start);
        assert.ok(promiseFailure instanceof AggregateError);
        assert.equal(promiseFailure.errors.length, 2);
        assert.ok(promiseFailure.errors[0] instanceof Error);
        assert.equal(promiseFailure.errors[1], observerFailure);
        const callback = operation === 'create'
          ? await callbackOutcome<CreateResult>((done) => facade.create('missing_sample', done))
          : await callbackOutcome<MigrationStatus[]>((done) => facade.status(done));
        assert.ok(callback.error instanceof AggregateError);
        assert.equal(callback.error.errors.length, 2);
        assert.ok(callback.error.errors[0] instanceof Error);
        assert.equal(callback.error.errors[1], observerFailure);
        assert.equal(callback.error.errors[0].name, promiseFailure.errors[0].name);
        assert.equal(callback.error.errors[0].message, promiseFailure.errors[0].message);
        assert.equal(callback.result, undefined);
        const original = promiseFailure.errors[0];
        assert.ok('code' in original);
        assert.equal(original.code, operation === 'create' ? 'ENOENT' : 'missing-applied-files');
        assert.deepEqual(await database.collection('changelog').find({}).toArray(), before);
      }
      assert.equal(observations.length, 4);
      assertReadCommands(observations);
    });

  }


  for (const backend of ['sql', 'mongo'] as const) {
    it(`${backend} create isolates concurrent A/B template targets without changing application cwd or options`, async () => {
      const api = await owners('esm');
      const cwd = process.cwd();
      const globalOptions = Reflect.get(globalThis, 'options');
      const roots = ['a', 'b'].map((label) => path.join(root, backend, 'isolated-create', label));
      for (const createDir of roots) {
        await mkdir(createDir, { recursive: true });
        if (backend === 'mongo') await copyFile(path.join(fixtureRoot, 'test', 'fixtures', 'sample-migration.ts'), path.join(createDir, 'sample-migration.ts'));
      }
      const facades = roots.map((createDir) => backend === 'sql'
        ? api.createSqlPreparationFacade({ database: { client: 'sqlite3', connection: { filename: path.join(root, 'never-opened-isolation.sqlite') }, useNullAsDefault: true }, migrationsDir: createDir, createDir })
        : api.createMongoPreparationFacade({ uri: 'invalid-uri-create-must-not-parse', databaseName: 'never_opened_isolation', migrationsDir: createDir, createDir }));
      const created = await Promise.all(facades.map((facade) => facade.create('isolated_template')));
      for (const [index, entry] of created.entries()) {
        assert.equal(entry.deployedId, entry.sourceId.replace(/\.ts$/, '.js'));
        assert.ok((await stat(path.join(roots[index], entry.sourceId))).isFile());
      }
      await assert.rejects(stat(path.join(root, 'never-opened-isolation.sqlite')), (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
      assert.equal(process.cwd(), cwd);
      assert.equal(Reflect.get(globalThis, 'options'), globalOptions);
    });
  }

  for (const backend of ['sql', 'mongo'] as const) {
    it(`${backend} creation keeps its native identity through the existing real TS build helper`, async () => {
      const api = await owners('esm');
      const createDir = path.join(root, backend, 'compiled-template');
      await mkdir(createDir, { recursive: true });
      if (backend === 'mongo') await copyFile(path.join(fixtureRoot, 'test', 'fixtures', 'sample-migration.ts'), path.join(createDir, 'sample-migration.ts'));
      const facade = backend === 'sql'
        ? api.createSqlPreparationFacade({ database: { client: 'sqlite3', connection: { filename: path.join(root, 'never-opened-build.sqlite') }, useNullAsDefault: true }, migrationsDir: createDir, createDir })
        : api.createMongoPreparationFacade({ uri: 'invalid-uri-create-must-not-parse', databaseName: 'never_opened_build', migrationsDir: createDir, createDir });
      const created = await facade.create('compiled_identity');
      const built = await buildGeneratedMigration(backend, path.join(createDir, created.sourceId), { scratchRoot: path.join(root, 'build'), evidenceRoot: path.join(root, 'build-evidence') });
      assert.equal(path.basename(built.deployedPath), created.deployedId);
      assert.equal(path.basename(built.retainedSourcePath), created.sourceId);
      assert.equal(path.basename(built.retainedDeclarationPath), created.deployedId.replace(/\.js$/, '.d.ts'));
      await assert.rejects(stat(path.join(root, 'never-opened-build.sqlite')), (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
    });
  }

  it('retains compiler failure and closes the accepted owned build process', async () => {
    const sourceDir = path.join(root, 'compiler-failure-source');
    await mkdir(sourceDir, { recursive: true });
    const sourcePath = path.join(sourceDir, 'invalid_compiler.ts');
    await writeFile(sourcePath, 'export const invalid: string = 1;\n');
    await assert.rejects(buildGeneratedMigration('sql', sourcePath, { scratchRoot: path.join(root, 'compiler-failure-build'), evidenceRoot: path.join(root, 'compiler-failure-evidence') }), /TS2322/);
    await closeOwnedRaceWorkers();
    await assert.rejects(stat(path.join(root, 'compiler-failure-evidence', 'generated')), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT');
  });

  it('reuses the accepted process deadline and descendant cleanup owner', async () => {
    const observed = await processForceTerminationEvidence();
    assert.equal(observed.escalated, true);
    assert.equal(observed.parentClosed, true);
    assert.equal(observed.descendantClosed, true);
  });
});
