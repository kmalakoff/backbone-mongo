// This suite downloads MongoDB 8.2.6 when the worktree-local binary cache is empty.
import assert from 'assert';
import { mkdir, writeFile } from 'fs/promises';
import { MongoClient } from 'mongodb';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  cleanupScratch,
  closeOwnedRaceWorkers,
  type Evidence,
  mongoBaselineEvidence,
  mongoBinaryCacheRoot,
  mongoCrossTalkEvidence,
  mongoEarlyChildFailureEvidence,
  mongoMissingHistoryEvidence,
  mongoOrderingAndFailureEvidence,
  mongoRaceEvidence,
  mongoServerEvidence,
  packageEvidence,
  prepareScratch,
  scratchRoot,
  sqlEvidence,
  sqlFacadeParityEvidence,
  sqlOrderingAndFailureEvidence,
} from '../lib/proof.ts';

interface MemoryServer {
  getUri(): string;
  stop(): Promise<boolean>;
}

const evidence: Evidence = {
  commands: ['nvu 22 npm run validate', 'nvu 22 npm test'],
};
let server: MemoryServer | undefined;
let client: MongoClient | undefined;
let uri = '';

describe('migration runner Gate 1', () => {
  before(async () => {
    await prepareScratch();
    process.env.MONGOMS_DOWNLOAD_DIR = mongoBinaryCacheRoot;
    process.env.MONGOMS_MD5_CHECK = 'true';
    const databasePath = path.join(scratchRoot, 'mongo', 'data');
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
    evidence.mongoServer = await mongoServerEvidence(client.db('admin'));
  });

  after(async () => {
    await closeOwnedRaceWorkers();
    if (client) await client.close();
    if (server) await server.stop();
    console.log(`GATE1_EVIDENCE=${JSON.stringify(evidence)}`);
    const evidenceDir = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), 'evidence');
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(path.join(evidenceDir, 'gate-1.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    await cleanupScratch();
  });

  it('records exact packages, exports, and real Knex operations', async () => {
    evidence.runtime = await packageEvidence();
    evidence.sql = await sqlEvidence();
    evidence.facadeParity = await sqlFacadeParityEvidence();
    evidence.sqlRisks = await sqlOrderingAndFailureEvidence();
  });

  it('runs create, status, apply-all, and undo-one against real MongoDB', async () => {
    assert.ok(client);
    evidence.mongo = await mongoBaselineEvidence(uri, client);
  });

  it('reproduces Mongo global configuration, ordering, and failure state', async () => {
    assert.ok(client);
    evidence.mongoCrossTalk = await mongoCrossTalkEvidence(uri, client);
    evidence.mongoRisks = await mongoOrderingAndFailureEvidence(uri, client);
    evidence.mongoMissingHistory = await mongoMissingHistoryEvidence(uri, client);
  });

  it('reproduces concurrent migrate-mongo execution with independent processes', async () => {
    assert.ok(client);
    evidence.mongoEarlyChildFailure = await mongoEarlyChildFailureEvidence(uri);
    const race = await mongoRaceEvidence(uri, client);
    evidence.mongoRace = race;
    assert.equal(race.reproduced, true);
  });
});
