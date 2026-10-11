// Installs registry dependencies and owns a real private MongoDB server on the reviewed host.

import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'assert';
import { safeRmSync } from 'fs-remove-compat';
import { repository, startMongo } from '../lib/mongo.ts';
import { runOwnedProcess } from '../lib/process.ts';

const fixture = path.join(repository, 'test/fixtures/packed');
const ormTarHash = '4b379681acd65481472f86bdbf1d65bba176f21df0582c655788e8719166e128';
const ormManifestHash = '0e1750d0af7bcf39e1b377ddb73a78262ae9c0aa0b7350f5cce94c86e2d3cbaa';
const modes = [
  { config: 'node16', condition: 'cjs', type: 'commonjs' },
  { config: 'nodenext', condition: 'esm', type: 'module' },
] as const;

function hash(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function object(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value), 'Expected fixture object');
  return value as Record<string, unknown>;
}

function json(file: string): Record<string, unknown> {
  return object(JSON.parse(readFileSync(file, 'utf8')));
}

function within(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function files(root: string): string[] {
  return readdirSync(root, { recursive: true })
    .map(String)
    .filter((relative) => relative !== 'node_modules' && !relative.startsWith(`node_modules${path.sep}`))
    .filter((relative) => {
      const stats = lstatSync(path.join(root, relative));
      assert.strictEqual(stats.isSymbolicLink(), false, `Unexpected immutable-package symlink: ${relative}`);
      return stats.isFile();
    })
    .map((relative) => relative.split(path.sep).join('/'))
    .sort();
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function copy(source: string, destination: string): void {
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  assert.strictEqual(hash(destination), hash(source), `Fixture copy changed ${source}`);
}

function cleanAncestors(root: string): void {
  // FAMILY's packed-consumer pattern keeps consumers outside checkout dependency ancestry.
  for (let current = path.dirname(root); ; current = path.dirname(current)) {
    assert.strictEqual(existsSync(path.join(current, 'node_modules')), false, `Packed consumer has dependency-bearing ancestor: ${current}`);
    if (path.dirname(current) === current) break;
  }
}

function assertToolOwner(root: string): string {
  const local = createRequire(path.join(root, 'package.json'));
  const expected = object(json(path.join(root, 'package.json')).dependencies);
  for (const [name, version] of Object.entries(expected)) {
    const manifest = realpathSync(local.resolve(`${name}/package.json`));
    assert.ok(within(path.join(root, 'node_modules'), manifest), `Tool escaped private owner: ${name}`);
    assert.strictEqual(json(manifest).version, version);
  }
  const stack = realpathSync(local.resolve('ts-dev-stack/bin/cli.js'));
  const build = realpathSync(createRequire(stack).resolve('tsds-build'));
  const transform = realpathSync(createRequire(build).resolve('ts-swc-transform'));
  const compiler = realpathSync(createRequire(transform).resolve('typescript/bin/tsc'));
  for (const resolved of [stack, build, transform, compiler]) assert.ok(within(path.join(root, 'node_modules'), resolved));
  for (const relative of readdirSync(path.join(root, 'node_modules'), { recursive: true }).map(String)) {
    const file = path.join(root, 'node_modules', relative);
    if (lstatSync(file).isSymbolicLink()) assert.ok(within(root, realpathSync(file)), `Tool symlink escaped owner: ${relative}`);
  }
  return stack;
}

function verifyInstalled(app: string, expectedMongo: readonly string[], ormManifest: string): void {
  const local = createRequire(path.join(app, 'package.json'));
  const mongo = path.dirname(realpathSync(local.resolve('backbone-mongo/package.json')));
  const orm = path.dirname(realpathSync(local.resolve('backbone-orm/package.json')));
  const dependencies = path.join(app, 'node_modules');
  for (const root of [mongo, orm]) assert.ok(within(dependencies, root));
  assert.deepStrictEqual(files(mongo), expectedMongo);
  for (const relative of expectedMongo) assert.strictEqual(hash(path.join(mongo, relative)), hash(path.join(repository, relative)), `Packed Mongo bytes changed: ${relative}`);
  const entries = readFileSync(ormManifest, 'utf8')
    .trim()
    .split('\n')
    .map((line) => {
      const match = /^([a-f0-9]{64}) {2}package\/(.+)$/.exec(line);
      assert.ok(match, 'Malformed accepted ORM artifact manifest');
      assert.ok(within(orm, path.resolve(orm, match[2])), 'ORM artifact path escaped package');
      return { hash: match[1], file: match[2] };
    });
  assert.strictEqual(entries.length, 412);
  assert.deepStrictEqual(files(orm), entries.map(({ file }) => file).sort());
  for (const entry of entries) assert.strictEqual(hash(path.join(orm, entry.file)), entry.hash, `Installed ORM differs from accepted payload: ${entry.file}`);
  const backbone = realpathSync(local.resolve('backbone'));
  for (const name of ['backbone-mongo', 'backbone-orm']) {
    assert.strictEqual(realpathSync(createRequire(local.resolve(name)).resolve('backbone')), backbone);
  }
  for (const name of ['backbone', 'mongodb', 'queue-cb', 'underscore', '@types/backbone', '@types/node']) {
    assert.ok(within(dependencies, realpathSync(local.resolve(`${name}/package.json`))), `Consumer dependency escaped: ${name}`);
  }
  for (const name of ['ts-dev-stack', 'tsds-build', 'typescript', 'tsds-config']) assert.strictEqual(existsSync(path.join(dependencies, name)), false, `Tool leaked into runtime consumer: ${name}`);
}

describe('isolated packed Mongo consumers', () => {
  it('checks installed Node16/NodeNext declarations and real native CJS/ESM CRUD parity', async () => {
    const npmCandidate = process.env.npm_execpath;
    assert.ok(npmCandidate && existsSync(npmCandidate), 'Run through npm so the exact npm CLI is available');
    const npm = npmCandidate;
    const id = randomUUID();
    const scratchParent = path.join(repository, '.tmp/packed-consumers');
    mkdirSync(scratchParent, { recursive: true });
    const scratch = mkdtempSync(path.join(scratchParent, 'run-'));
    const evidence = path.join(repository, '.tmp/production-port/packed-consumer-evidence', id);
    mkdirSync(scratch, { recursive: true });
    mkdirSync(evidence, { recursive: true });
    const repositoryParent = path.basename(path.dirname(repository)) === '.worktrees' ? path.dirname(path.dirname(path.dirname(repository))) : path.dirname(repository);
    const isolationParent = path.join(repositoryParent, '.tmp');
    assert.ok(!within(repository, isolationParent), 'Packed consumer isolation cannot be below the owning checkout');
    mkdirSync(isolationParent, { recursive: true });
    const isolation = mkdtempSync(path.join(isolationParent, 'backbone-mongo-packed-'));
    let server: Awaited<ReturnType<typeof startMongo>> | undefined;
    let failure: unknown;
    let failed = false;
    const cleanup: unknown[] = [];
    let childFailure = false;
    let command = 0;
    async function run(label: string, args: readonly string[], cwd: string, negative = false) {
      let result: Awaited<ReturnType<typeof runOwnedProcess>>;
      try {
        result = await runOwnedProcess(process.execPath, args, { cwd, timeoutMs: 120_000 });
      } catch (error: unknown) {
        childFailure = true;
        writeFileSync(path.join(evidence, `${++command}-${label}-infrastructure.log`), String(error));
        throw error;
      }
      const output = `${result.stdout}${result.stderr}`;
      writeFileSync(path.join(evidence, `${++command}-${label}.log`), output);
      process.stdout.write(`${label}: exit ${result.status}; log ${path.join(evidence, `${command}-${label}.log`)}\n`);
      assert.doesNotMatch(output, /Module missing:/, 'House command attempted install fallback; stop for review');
      if (negative) assert.notStrictEqual(result.status, 0, `${label} unexpectedly compiled`);
      else assert.strictEqual(result.status, 0, `${label} failed; see preserved log`);
      return result;
    }
    async function install(root: string, label: string): Promise<void> {
      const prefix = await run(`${label}-prefix`, [npm, 'prefix'], root);
      assert.strictEqual(realpathSync(prefix.stdout.trim()), realpathSync(root), 'npm prefix escaped fixture owner');
      await run(`${label}-install`, [npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', path.join(scratch, 'npm-cache')], root);
    }
    try {
      cleanAncestors(isolation);
      const ownerManifest = json(path.join(repository, 'package.json'));
      const declaredOrm = object(ownerManifest.dependencies)['backbone-orm'];
      assert.ok(typeof declaredOrm === 'string' && declaredOrm.startsWith('file:'), 'Missing approved immutable ORM tar dependency');
      const originalOrmTar = declaredOrm.slice(5);
      const originalOrmManifest = path.join(path.dirname(originalOrmTar), 'artifact-sha256.txt');
      assert.strictEqual(hash(originalOrmTar), ormTarHash);
      assert.strictEqual(hash(originalOrmManifest), ormManifestHash);
      const inputs = path.join(isolation, 'inputs');
      mkdirSync(inputs);
      const ormTar = path.join(inputs, 'backbone-orm-0.7.14.tgz');
      const ormManifest = path.join(inputs, 'orm-artifact-sha256.txt');
      copy(originalOrmTar, ormTar);
      copy(originalOrmManifest, ormManifest);
      const expectedMongo = ['LICENSE', 'README.md', 'package.json', ...files(path.join(repository, 'dist')).map((file) => `dist/${file}`)].sort();
      assert.strictEqual(expectedMongo.length, 82, 'Reviewed Mongo payload shape changed; review contents before accepting');
      const packOutput = await run('pack', [npm, 'pack', repository, '--ignore-scripts', '--json', '--pack-destination', inputs, '--cache', path.join(scratch, 'npm-cache')], repository);
      const parsed: unknown = JSON.parse(packOutput.stdout);
      const packs: unknown[] = Array.isArray(parsed) ? parsed : Object.values(object(parsed));
      assert.strictEqual(packs.length, 1);
      const pack = object(packs[0]);
      assert.strictEqual(pack.name, 'backbone-mongo');
      assert.strictEqual(pack.version, ownerManifest.version);
      assert.ok(typeof pack.filename === 'string' && path.basename(pack.filename) === pack.filename);
      assert.ok(Array.isArray(pack.files));
      assert.deepStrictEqual(
        pack.files
          .map((entry: unknown) => {
            const value = object(entry);
            assert.ok(typeof value.path === 'string');
            assert.strictEqual(value.size, lstatSync(path.join(repository, value.path)).size);
            return value.path;
          })
          .sort(),
        expectedMongo
      );
      const mongoTar = path.join(inputs, pack.filename);
      writeJson(path.join(evidence, 'inputs.json'), {
        mongoTarSha256: hash(mongoTar),
        ormTarSha256: hash(ormTar),
        ormManifestSha256: hash(ormManifest),
        mongoFiles: expectedMongo.map((file) => ({ file, sha256: hash(path.join(repository, file)) })),
        ormOverride: 'fixture-only copied identical tar; not unchanged-manifest portability',
      });

      const tools = path.join(scratch, 'tools');
      mkdirSync(tools);
      copy(path.join(fixture, 'tools.json'), path.join(tools, 'package.json'));
      await install(tools, 'tools');
      const tsds = assertToolOwner(tools);
      const compiler: typeof import('typescript') = createRequire(tsds)('typescript');
      copy(path.join(tools, 'package-lock.json'), path.join(evidence, 'tools-package-lock.json'));
      const toolConfig = path.join(tools, 'node_modules/tsds-config/tsconfig.json');
      const apps: Array<{ root: string; condition: 'cjs' | 'esm' }> = [];
      for (const mode of modes) {
        const app = path.join(isolation, mode.config);
        mkdirSync(app);
        cleanAncestors(app);
        writeJson(path.join(app, 'package.json'), {
          name: `backbone-mongo-packed-${mode.config}`,
          version: '0.0.0-private',
          private: true,
          type: mode.type,
          source: 'src/index.ts',
          tsds: { targets: [mode.condition] },
          dependencies: { 'backbone-mongo': `file:${mongoTar}`, 'backbone-orm': `file:${ormTar}`, backbone: object(ownerManifest.dependencies).backbone, '@types/node': object(ownerManifest.devDependencies)['@types/node'] },
          overrides: { 'backbone-orm': '$backbone-orm' },
        });
        await install(app, mode.config);
        verifyInstalled(app, expectedMongo, ormManifest);
        copy(path.join(app, 'package-lock.json'), path.join(evidence, `${mode.config}-package-lock.json`));
        for (const relative of ['test/fixtures/packed/runtime.ts', 'test/lib/mongoCrud.ts', 'test/lib/public.ts']) copy(path.join(repository, relative), path.join(app, 'src', relative));
        copy(path.join(fixture, 'consumer.ts'), path.join(app, 'src/consumer.ts'));
        writeFileSync(path.join(app, 'src/index.ts'), "export * from './consumer.ts';\nimport './test/fixtures/packed/runtime.ts';\n");
        const config = json(path.join(fixture, `tsconfig.${mode.config}.json`));
        writeJson(path.join(app, 'tsconfig.json'), { extends: toolConfig, ...config });
        const read = compiler.readConfigFile(path.join(app, 'tsconfig.json'), compiler.sys.readFile);
        assert.strictEqual(read.error, undefined);
        const parsedConfig = compiler.parseJsonConfigFileContent(read.config, compiler.sys, app);
        assert.deepStrictEqual(parsedConfig.errors, []);
        const resolutions = ['backbone-mongo', 'backbone-orm'].map((name) => {
          const resolved = compiler.resolveModuleName(name, path.join(app, 'src/consumer.ts'), parsedConfig.options, compiler.sys, undefined, undefined, mode.condition === 'cjs' ? compiler.ModuleKind.CommonJS : compiler.ModuleKind.ESNext).resolvedModule;
          assert.ok(resolved);
          assert.ok(within(path.join(app, 'node_modules'), realpathSync(resolved.resolvedFileName)));
          return { name, file: resolved.resolvedFileName, sha256: hash(resolved.resolvedFileName) };
        });
        const declaration = path.join(app, 'node_modules/backbone-mongo/dist', mode.condition, 'index.d.ts');
        assert.strictEqual(resolutions[0].file, declaration, 'Compiler did not resolve installed declaration condition');
        writeJson(path.join(evidence, `${mode.config}-declaration-resolution.json`), resolutions);
        await run(`${mode.config}-positive`, [tsds, 'build'], app);
        assert.ok(existsSync(path.join(app, 'dist', mode.condition, 'consumer.d.ts')));
        assertToolOwner(tools);
        const negative = path.join(app, 'negative');
        mkdirSync(negative);
        writeJson(path.join(negative, 'package.json'), { name: `backbone-mongo-packed-${mode.config}-negative`, version: '0.0.0-private', private: true, type: mode.type, source: 'src/index.ts', tsds: { targets: [mode.condition] } });
        writeJson(path.join(negative, 'tsconfig.json'), { extends: toolConfig, ...config });
        copy(path.join(repository, 'test/tooling/type-gate/sentinel/index.ts'), path.join(negative, 'src/index.ts'));
        const rejected = await run(`${mode.config}-negative`, [tsds, 'build'], negative, true);
        const diagnostics = `${rejected.stdout}${rejected.stderr}`;
        assert.match(diagnostics, /index\.ts\(3,7\): error TS2322/);
        assert.match(diagnostics, /index\.ts\(5,\d+\): error TS2322: Type 'true' is not assignable/);
        apps.push({ root: app, condition: mode.condition });
      }
      server = await startMongo();
      for (const app of apps) {
        const output = await run(`${app.condition}-runtime`, [path.join(app.root, 'dist', app.condition, 'index.js'), '--uri', server.uri, '--root', app.root, '--condition', app.condition], app.root);
        assert.ok(output.stdout.includes(`packed ${app.condition} CRUD/CAS/errors and cleanup passed`));
      }
    } catch (error: unknown) {
      failure = error;
      failed = true;
    } finally {
      if (server) {
        try {
          await server.close();
          assert.strictEqual(existsSync(server.root), false);
        } catch (error: unknown) {
          cleanup.push(error);
        }
      }
      for (const root of [isolation, scratch]) {
        if (childFailure) {
          cleanup.push(new Error(`Owned child infrastructure failure; retained private root pending cleanup review: ${root}`));
          continue;
        }
        try {
          safeRmSync(root);
          assert.strictEqual(existsSync(root), false);
        } catch (error: unknown) {
          cleanup.push(error);
        }
      }
      try {
        writeJson(path.join(evidence, 'cleanup.json'), { passed: cleanup.length === 0, isolationRemoved: !existsSync(isolation), scratchRemoved: !existsSync(scratch), serverRemoved: !server || !existsSync(server.root) });
      } catch (error: unknown) {
        cleanup.push(error);
      }
    }
    if (cleanup.length) throw new AggregateError(failed ? [failure, ...cleanup] : cleanup, 'Packed consumer cleanup failed');
    if (failed) throw failure;
  });
});
