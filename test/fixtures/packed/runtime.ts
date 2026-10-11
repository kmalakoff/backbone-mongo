import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArgs } from 'node:util';
import assert from 'assert';
import Backbone from 'backbone';
import Mongo from 'backbone-mongo';
import ORM from 'backbone-orm';
import { exerciseMongoCrud } from '../../lib/mongoCrud.ts';

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { uri: { type: 'string' }, root: { type: 'string' }, condition: { type: 'string' } } });
  assert.ok(values.uri && values.root);
  assert.strictEqual(process.env.NODE_PATH, undefined, 'Native consumer must not inherit a global module path');
  assert.doesNotMatch(process.env.NODE_OPTIONS ?? '', /(?:^|\s)(?:--(?:import|loader|experimental-loader|require)(?:=|\s)|-r(?:=|\s))/, 'Native consumer must not inherit loader hooks');
  const local = createRequire(path.join(values.root, 'package.json'));
  const backbone = realpathSync(local.resolve('backbone'));
  for (const name of ['backbone-mongo', 'backbone-orm']) {
    const entry = realpathSync(local.resolve(name));
    assert.ok(entry.startsWith(`${realpathSync(path.join(values.root, 'node_modules'))}${path.sep}`));
    assert.strictEqual(realpathSync(createRequire(entry).resolve('backbone')), backbone);
  }
  assert.strictEqual(Mongo.Backbone, Backbone);
  assert.strictEqual(ORM.Backbone, Backbone);
  try {
    await exerciseMongoCrud(values.uri);
  } finally {
    await ORM.ConnectionPool.disposeAll();
  }
  process.stdout.write(`packed ${values.condition} CRUD/CAS/errors and cleanup passed\n`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
