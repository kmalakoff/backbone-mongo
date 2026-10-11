import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'assert';
import { safeRmSync } from 'fs-remove-compat';
import { runOwnedProcess } from '../../lib/process.ts';

describe('authored dual tsds type gate', () => {
  it('compiles the public consumer and real owners, then rejects TS2322 sentinel', async () => {
    const directory = path.dirname(fileURLToPath(import.meta.url));
    const tsds = path.resolve(directory, '../../../node_modules/ts-dev-stack/bin/cli.js');
    const sentinel = path.join(directory, 'sentinel');
    try {
      const positive = await runOwnedProcess(process.execPath, [tsds, 'build'], { cwd: directory, timeoutMs: 60_000 });
      process.stdout.write(`${positive.stdout}${positive.stderr}`);
      assert.strictEqual(positive.status, 0);
      const negative = await runOwnedProcess(process.execPath, [tsds, 'build'], { cwd: sentinel, timeoutMs: 30_000 });
      process.stdout.write(`${negative.stdout}${negative.stderr}`);
      assert.notStrictEqual(negative.status, 0);
      assert.match(`${negative.stdout}${negative.stderr}`, /index\.ts\(3,7\): error TS2322/);
      assert.match(`${negative.stdout}${negative.stderr}`, /index\.ts\(5,\d+\): error TS2322: Type 'true' is not assignable/);
    } finally {
      safeRmSync(path.join(directory, 'dist'));
      safeRmSync(path.join(sentinel, 'dist'));
    }
  });
});
