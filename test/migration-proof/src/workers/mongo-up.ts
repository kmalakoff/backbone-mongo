import migrateMongo, { type Config } from 'migrate-mongo';
import { MongoClient } from 'mongodb';

interface WorkerOptions {
  uri: string;
  databaseName: string;
  migrationsDir: string;
}

interface WorkerMessage {
  type: 'go';
}

function send(message: object): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!process.send) return reject(new Error('Mongo race worker requires an IPC channel'));
    process.send(message, (error) => (error ? reject(error) : resolve()));
  });
}

function receive(): Promise<WorkerMessage> {
  return new Promise((resolve) => process.once('message', (message) => resolve(message as WorkerMessage)));
}

async function run(options: WorkerOptions): Promise<void> {
  const client = new MongoClient(options.uri);
  let result: object;
  try {
    await client.connect();
    const runnerConfig: Config = {
      mongodb: { url: options.uri, databaseName: options.databaseName, options: {} },
      migrationsDir: options.migrationsDir,
      changelogCollectionName: 'changelog',
      lockCollectionName: 'changelog_lock',
      lockTtl: 60,
      migrationFileExtension: '.js',
      useFileHash: false,
      moduleSystem: 'esm',
    };
    migrateMongo.config.set(runnerConfig);
    await send({ type: 'ready' });
    const message = await receive();
    if (message.type !== 'go') {
      result = { type: 'result', ok: false, error: `Unexpected worker message: ${message.type}`, pid: process.pid };
    } else {
      const applied = await migrateMongo.up(client.db(options.databaseName), client);
      result = { type: 'result', ok: true, applied, pid: process.pid };
    }
  } catch (error) {
    result = { type: 'result', ok: false, error: error instanceof Error ? error.message : String(error), pid: process.pid };
  }

  await client.close();
  await send({ ...result, clientClosed: true });
  process.disconnect();
}

async function main(): Promise<void> {
  const encodedOptions = process.argv[2];
  if (!encodedOptions) throw new Error('Mongo race worker requires encoded options');
  await run(JSON.parse(encodedOptions) as WorkerOptions);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
  if (process.connected) process.disconnect();
});
