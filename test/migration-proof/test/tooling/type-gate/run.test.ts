import assert from 'assert';
import { createHash } from 'crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'fs/promises';
import { safeRmSync } from 'fs-remove-compat';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { launchOwnedCompiler, type OwnedCompiler } from '../../lib/proof.ts';

const gateRoot = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(gateRoot, '../../..');
const packageName = 'backbone-mongo-migration-proof';
const consumerSHA256 = '4fc3aa2fa9b651db575da7c9ffd6067acdebdac0033e5247bf8b1fe3c5f58771';
const compilerTimeoutMs = 60_000;
const sentinelRoot = path.join(gateRoot, 'sentinel');
const warningSentinelRoot = path.join(sentinelRoot, 'warning-case');
const fixtures = [gateRoot, ...['consumer-cjs', 'consumer-esm'].map((name) => path.join(gateRoot, name)), sentinelRoot, warningSentinelRoot];

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function assertAbsent(file: string): Promise<void> {
  try {
    await lstat(file);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`Managed type output already exists: ${file}`);
}

async function artifactAuthority(): Promise<Array<{ file: string; mode: number; sha256: string }>> {
  const entries: Array<{ file: string; mode: number; sha256: string }> = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else {
        assert.ok(entry.isFile(), `Unexpected artifact kind: ${file}`);
        entries.push({ file: path.relative(packageRoot, file), mode: (await lstat(file)).mode & 0o777, sha256: digest(await readFile(file)) });
      }
    }
  }
  entries.push({ file: 'package.json', mode: (await lstat(path.join(packageRoot, 'package.json'))).mode & 0o777, sha256: digest(await readFile(path.join(packageRoot, 'package.json'))) });
  await visit(path.join(packageRoot, 'dist'));
  return entries;
}

describe('managed migration preparation types', () => {
  it('checks authored dual types, strict public consumers and the TS2322 sentinel', async () => {
    const children: OwnedCompiler[] = [];
    const ownedPaths: string[] = [];
    const failures: unknown[] = [];
    let before: Awaited<ReturnType<typeof artifactAuthority>> | undefined;
    try {
      before = await artifactAuthority();
      for (const format of ['cjs', 'esm']) {
        for (const file of ['index.js', 'index.d.ts', 'package.json']) {
          assert.ok((await lstat(path.join(packageRoot, 'dist', format, file))).isFile());
        }
      }
      const requireFromConsumer = createRequire(path.join(gateRoot, 'consumer-cjs', 'package.json'));
      assert.equal(await realpath(requireFromConsumer.resolve(packageName)), await realpath(path.join(packageRoot, 'dist/cjs/index.js')));
      assert.equal(await realpath(fileURLToPath(import.meta.resolve(packageName))), await realpath(path.join(packageRoot, 'dist/esm/index.js')));

      const consumerBytes = await readFile(path.join(packageRoot, 'test/types/facade-consumer.ts'));
      assert.equal(digest(consumerBytes), consumerSHA256, 'Public consumer must match the reviewed staged owner');
      for (const fixture of fixtures) await assertAbsent(path.join(fixture, 'dist'));
      for (const name of ['consumer-cjs', 'consumer-esm']) await assertAbsent(path.join(gateRoot, name, 'src'));
      for (const name of ['consumer-cjs', 'consumer-esm']) {
        const sourceRoot = path.join(gateRoot, name, 'src');
        await mkdir(sourceRoot);
        ownedPaths.push(sourceRoot);
        const destination = path.join(sourceRoot, 'index.ts');
        await writeFile(destination, consumerBytes, { flag: 'wx' });
        assert.equal(digest(await readFile(destination)), consumerSHA256);
      }

      for (const fixture of fixtures) {
        ownedPaths.push(path.join(fixture, 'dist'));
        const child = launchOwnedCompiler(fixture, compilerTimeoutMs);
        children.push(child);
        const result = await child.wait();
        const output = `${result.stdout}${result.stderr}`;
        process.stdout.write(output);
        assert.equal(result.signal, null);
        if (fixture === sentinelRoot || fixture === warningSentinelRoot) {
          assert.equal(result.status, 0, 'Controlled callback entry must complete normally before accepting a negative receipt');
          if (result.callback.ok) throw new Error('Invalid sentinel produced a successful compiler callback');
          const diagnosticPattern = fixture === sentinelRoot
            ? /index\.ts\(1,7\): error TS2322:/
            : /ExperimentalWarning\.ts\(1,7\): error TS2322:/;
          assert.match(result.callback.error.message, diagnosticPattern);
          if (fixture === warningSentinelRoot) assert.match(result.callback.error.message, /ExperimentalWarning/);
          const diagnostics = output.match(/[^\r\n]*error TS\d+[^\r\n]*/g) ?? [];
          assert.ok(diagnostics.length > 0, 'Expected a TypeScript diagnostic');
          assert.ok(diagnostics.every((line) => diagnosticPattern.test(line)), 'Only the owned TS2322 sentinel diagnostic is accepted');
        } else {
          if (!result.callback.ok) {
            const error = new Error(result.callback.error.message);
            error.name = result.callback.error.name;
            error.stack = result.callback.error.stack;
            throw Object.assign(error, { callback: result.callback.error, stdout: result.stdout, stderr: result.stderr });
          }
          assert.equal(result.status, 0, `Type build failed in ${path.relative(gateRoot, fixture) || 'authored owner'}`);
          const targets = fixture === gateRoot ? ['cjs', 'esm'] : [fixture.endsWith('consumer-cjs') ? 'cjs' : 'esm'];
          for (const target of targets) {
            const declaration = fixture === gateRoot ? 'test/tooling/type-gate/src/index.d.ts' : 'index.d.ts';
            for (const file of ['index.js', declaration, 'package.json']) {
              assert.ok((await lstat(path.join(fixture, 'dist', target, file))).isFile());
            }
          }
        }
      }
      for (const phase of ['immediate', 'exit']) {
        const options = phase === 'immediate' ? { postCallbackFatal: true } : { postCallbackExitFatal: true };
        const fatalMessage = phase === 'immediate' ? 'Owned compiler post-callback fatal' : 'Owned compiler exit-listener fatal';
        const fatalChild = launchOwnedCompiler(warningSentinelRoot, compilerTimeoutMs, options);
        children.push(fatalChild);
        const fatalOutcome = fatalChild.wait().then((result) => {
          process.stdout.write(`${result.stdout}${result.stderr}`);
          assert.equal(phase, 'exit', 'Only the already-exiting boundary should escape this classifier');
          assert.equal(result.status, 0);
          assert.equal(result.signal, null);
          if (result.callback.ok) throw new Error('Exit baseline did not receive the failed warning sentinel');
          assert.match(result.callback.error.message, /ExperimentalWarning\.ts\(1,7\): error TS2322:/);
          assert.ok(result.stderr.includes(fatalMessage), 'Native fatal diagnostic must name the owned failure');
          process.stdout.write(`${JSON.stringify({ type: 'compiler-terminal-baseline', phase, classifierResolved: true, status: result.status, signal: result.signal, callbackOK: false, warningTS2322: true, fatalMessage })}\n`);
          return result;
        });
        await assert.rejects(fatalOutcome, (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /Controlled compiler receipt requires normal process completion/);
          const terminal: unknown = Reflect.get(error, 'compilerTerminal');
          assert.ok(terminal !== null && typeof terminal === 'object');
          assert.equal(Reflect.get(terminal, 'code'), phase === 'immediate' ? 1 : 2);
          assert.equal(Reflect.get(terminal, 'signal'), null);
          const callbacks = Reflect.get(error, 'compilerCallbacks');
          assert.ok(Array.isArray(callbacks));
          assert.equal(callbacks.length, 1);
          const callback: unknown = callbacks[0];
          assert.ok(callback !== null && typeof callback === 'object');
          assert.equal(Reflect.get(callback, 'ok'), false);
          const failure: unknown = Reflect.get(callback, 'error');
          assert.ok(failure !== null && typeof failure === 'object');
          const message: unknown = Reflect.get(failure, 'message');
          assert.ok(typeof message === 'string');
          assert.match(message, /ExperimentalWarning\.ts\(1,7\): error TS2322:/);
          const stdout: unknown = Reflect.get(error, 'stdout');
          const stderr: unknown = Reflect.get(error, 'stderr');
          assert.ok(typeof stdout === 'string' && typeof stderr === 'string');
          assert.ok(stderr.includes(fatalMessage), 'Native fatal diagnostic must name the owned failure');
          process.stdout.write(`${stdout}${stderr}`);
          process.stdout.write(`${JSON.stringify({ type: 'compiler-terminal-fatal', phase, code: Reflect.get(terminal, 'code'), callbackOK: false, warningTS2322: true, fatalMessage })}\n`);
          return true;
        });
      }
    } catch (original) {
      failures.push(original);
    } finally {
      for (const child of children) {
        try { await child.close(); }
        catch (cleanupFailure) { failures.push(cleanupFailure); }
      }
      if (children.every((child) => child.isClosed())) {
        for (const ownedPath of ownedPaths.reverse()) {
          try { safeRmSync(ownedPath); await assertAbsent(ownedPath); }
          catch (cleanupFailure) { failures.push(cleanupFailure); }
        }
      } else {
        failures.push(new Error('Compiler cleanup is uncertain; managed outputs retained'));
      }
      if (before !== undefined) {
        try { assert.deepEqual(await artifactAuthority(), before, 'Managed types changed root package artifacts'); }
        catch (authorityFailure) { failures.push(authorityFailure); }
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, 'Managed migration types and cleanup failed');
  });
});
