import assert from 'assert';
import { createHash } from 'crypto';
import { copyFile, mkdir, readFile } from 'fs/promises';
import { safeRm } from 'fs-remove-compat';
import path from 'path';
import { fileURLToPath } from 'url';
import type { MigrationCallback } from '../../src/types.ts';

export const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const repositoryRoot = path.resolve(fixtureRoot, '../..');
export const builtMigrationsRoot = path.join(fixtureRoot, 'dist', 'esm', 'proof-migrations');
export const builtMongoWorkerPath = path.join(fixtureRoot, 'dist', 'esm', 'workers', 'mongo-operation.js');
export const wave2ScratchRoot = path.join(repositoryRoot, '.tmp', `migration-proof-wave-2-resubmission-${process.pid}`);
export const wave2EvidenceRoot = path.join(fixtureRoot, 'evidence', 'wave-2-resubmission');
export const mongoBinaryCacheRoot = path.join(repositoryRoot, '.tmp', 'cache', 'mongodb-binaries');

function safeRemove(target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    safeRm(target, (error) => (error ? reject(error) : resolve()));
  });
}

export async function prepareWave2Scratch(): Promise<void> {
  await safeRemove(wave2ScratchRoot);
  await mkdir(wave2ScratchRoot, { recursive: true });
  await mkdir(wave2EvidenceRoot, { recursive: true });
}

export async function cleanupWave2Scratch(): Promise<void> {
  await safeRemove(wave2ScratchRoot);
}

export async function createWave2MigrationDirectory(backend: 'mongo' | 'sql', label: string, fileNames: string[]): Promise<string> {
  const destination = path.join(wave2ScratchRoot, backend, label, 'migrations');
  await mkdir(destination, { recursive: true });
  await Promise.all(fileNames.map((fileName) => copyFile(path.join(builtMigrationsRoot, backend, fileName), path.join(destination, fileName))));
  return destination;
}

export interface CallbackOutcome<T> {
  calls: number;
  error: Error | null;
  result?: T;
  returned: void;
}

export function callbackOutcome<T>(invoke: (callback: MigrationCallback<T>) => void): Promise<CallbackOutcome<T>> {
  return new Promise((resolve, reject) => {
    let calls = 0;
    const timer = setTimeout(() => reject(new Error('Timed out waiting for migration callback')), 10_000);
    const returned = invoke((error, result) => {
      calls++;
      setImmediate(() => {
        clearTimeout(timer);
        try {
          assert.equal(calls, 1);
          resolve({ calls, error, ...(result === undefined ? {} : { result }), returned });
        } catch (assertionError) {
          reject(assertionError);
        }
      });
    });
    assert.equal(returned, undefined);
  });
}

function digest(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function wave2IdentityEvidence(): Promise<Record<string, unknown>> {
  const packageLock = JSON.parse((await readFile(path.join(fixtureRoot, 'package-lock.json'))).toString()) as { packages: Record<string, { version?: string; integrity?: string }> };
  const packageNames = ['knex', 'migrate-mongo', 'mongodb', 'mongodb-memory-server', 'sqlite3', 'ts-dev-stack', 'tsds-config'];
  const sourceFiles = [
    'src/next/errors.ts',
    'src/next/isolated-mongo.ts',
    'src/next/mongo-history.ts',
    'src/next/mongo-protocol.ts',
    'src/next/sql-history.ts',
    'src/proof-migrations/mongo/202609090025_history_unavailable.ts',
    'src/workers/mongo-operation.ts',
    'test/fixtures/wave-2-process-tree-timeout.mjs',
    'test/integration/wave-2.test.ts',
    'test/lib/wave-2.ts',
    'test/types/wave-2-consumer.ts',
    'test/unit/next/errors.test.ts',
  ];
  const builtFiles = ['dist/cjs/next/isolated-mongo.js', 'dist/esm/next/isolated-mongo.js', 'dist/esm/workers/mongo-operation.js'];
  return {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    packages: Object.fromEntries(packageNames.map((name) => [name, packageLock.packages[`node_modules/${name}`]])),
    sourceSha256: Object.fromEntries(await Promise.all(sourceFiles.map(async (fileName) => [fileName, digest(await readFile(path.join(fixtureRoot, fileName)))] as const))),
    builtSha256: Object.fromEntries(await Promise.all(builtFiles.map(async (fileName) => [fileName, digest(await readFile(path.join(fixtureRoot, fileName)))] as const))),
  };
}
