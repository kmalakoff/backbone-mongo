import { readdir } from 'fs/promises';
import type { Db } from 'mongodb';
import path from 'path';
import { historyIdentityIssue, type HistoryOperation, MongoHistoryPreflightError } from './errors.ts';

export interface MongoHistorySnapshot {
  files: string[];
  historyIds: string[];
}

export async function readMongoHistoryIds(database: Db, changelogCollectionName: string): Promise<string[]> {
  const documents = await database.collection(changelogCollectionName).find({}).toArray();
  const entries = documents.map((document, index) => {
    if (typeof document.fileName !== 'string' || document.fileName.length === 0) {
      throw new Error(`Unsupported Mongo changelog entry at position ${index}: fileName must be a non-empty string`);
    }
    if (typeof document.migrationBlock !== 'number' || !Number.isFinite(document.migrationBlock)) {
      throw new Error(`Unsupported Mongo changelog entry ${document.fileName}: migrationBlock must be a finite number`);
    }
    return { fileName: document.fileName, migrationBlock: document.migrationBlock };
  });
  entries.sort((first, second) => first.migrationBlock - second.migrationBlock || first.fileName.localeCompare(second.fileName));
  return entries.map(({ fileName }) => fileName);
}

export async function readCompiledMigrationIds(migrationsDir: string, extension: string, excludedFileName?: string): Promise<string[]> {
  return (await readdir(migrationsDir)).filter((fileName) => path.extname(fileName) === extension && fileName !== excludedFileName).sort();
}

export async function preflightMongoHistory(database: Db, migrationsDir: string, extension: string, changelogCollectionName: string, operation: HistoryOperation): Promise<MongoHistorySnapshot> {
  const files = await readCompiledMigrationIds(migrationsDir, extension, `sample-migration${extension}`);
  let historyIds: string[];
  try {
    historyIds = await readMongoHistoryIds(database, changelogCollectionName);
  } catch (error) {
    throw new MongoHistoryPreflightError(operation, 'unsupported-history-entry', [], error instanceof Error ? error.message : String(error));
  }
  const uniqueHistoryIds = new Set(historyIds);

  const issue = historyIdentityIssue(files, historyIds);
  if (issue) {
    const detail = issue.code === 'duplicate-history' ? 'duplicate changelog entries' : 'applied migrations missing from disk';
    throw new MongoHistoryPreflightError(operation, issue.code, issue.ids, `Mongo ${operation} rejected ${detail}: ${issue.ids.join(', ')}`);
  }

  const appliedInFileOrder = files.filter((id) => uniqueHistoryIds.has(id));
  if (operation !== 'status' && historyIds.some((id, index) => appliedInFileOrder[index] !== id)) {
    throw new MongoHistoryPreflightError(operation, 'unsupported-history-order', historyIds, `Mongo ${operation} rejected changelog order that native down cannot reproduce: ${historyIds.join(', ')}`);
  }

  if (operation === 'up' && historyIds.length > 0) {
    const lastApplied = historyIds[historyIds.length - 1];
    const backdatedIds = files.filter((id) => !uniqueHistoryIds.has(id) && id < lastApplied);
    if (backdatedIds.length > 0) {
      throw new MongoHistoryPreflightError(operation, 'backdated-pending-files', backdatedIds, `Mongo up rejected pending migrations ordered before the last applied migration: ${backdatedIds.join(', ')}`);
    }
  }

  return { files, historyIds };
}
