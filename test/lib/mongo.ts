import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeRmSync } from 'fs-remove-compat';
import { MongoClient } from 'mongodb';
import { startOwnedProcess } from './process.ts';

export const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VERSION = '8.2.6';
const BINARY_HASH = '37e1656df8c55deb98928196ada454b243d6b641f2bf76958b9ccd85e6d36b55';

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No private Mongo port');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    })
  );
  return address.port;
}

export async function startMongo() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Prepare a reviewed mongod binary for this host; this fixture currently owns macOS ARM64 only');
  // MongoDB SSPL binary cache, retained from the reviewed 8.2.6 local server fixture.
  const binary = path.join(repository, '.tmp/cache/mongodb-binaries', `mongod-arm64-darwin-${VERSION}`);
  if (createHash('sha256').update(readFileSync(binary)).digest('hex') !== BINARY_HASH) throw new Error('Private mongod cache hash mismatch');
  const root = path.join(repository, '.tmp/mongo-tests', randomUUID());
  const databasePath = path.join(root, 'data');
  mkdirSync(databasePath, { recursive: true });
  const port = await availablePort();
  const uri = `mongodb://127.0.0.1:${port}/production_port`;
  const processOwner = startOwnedProcess(binary, ['--port', String(port), '--bind_ip', '127.0.0.1', '--dbpath', databasePath, '--wiredTigerCacheSizeGB', '0.25', '--quiet'], repository, 120_000);
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  async function close(): Promise<void> {
    try {
      await client.close();
    } finally {
      await processOwner.stop();
      await processOwner.result;
      safeRmSync(root);
    }
  }
  try {
    await Promise.race([
      client.connect(),
      processOwner.result.then((result) => {
        throw new Error(`mongod exited before readiness: ${result.stdout}${result.stderr}`);
      }),
    ]);
    const info = await client.db('admin').command({ buildInfo: 1 });
    if (info.version !== VERSION) throw new Error('Unexpected real Mongo server version');
    return { uri, client, close, root, version: VERSION };
  } catch (error: unknown) {
    try {
      await close();
    } catch (cleanup: unknown) {
      throw new AggregateError([error, cleanup], 'Mongo startup and cleanup failed');
    }
    throw error;
  }
}
