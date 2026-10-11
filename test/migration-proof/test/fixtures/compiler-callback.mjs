import { inspect, parseArgs } from 'node:util';
import { runCommand } from 'ts-dev-stack';

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outerModes = {
  '--root-build': ['build', []],
  '--managed-types': ['test:node', ['--no-timeouts', 'test/tooling/type-gate/run.test.ts', '--grep', '^managed migration preparation types ']],
};
const receiptHash = 'b5b6f51b3d64dcb1765a9a1ff9aec1c374795e4c5c8b056d974755223c0a7f26';
const toolVersions = {
  "tsds-build": "1.23.2",
  "tsds-mocha": "1.23.12",
  "ts-dev-stack": "1.22.6",
  "resolve": "1.22.12",
  "tsds-lib": "1.22.5"
};
const entryPath = fileURLToPath(import.meta.url);
const privateRoot = realpathSync(path.resolve(path.dirname(entryPath), '../..'));

function inside(root, file) {
  const relative = path.relative(root, realpathSync(file));
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `Tool must belong to the private owner: ${file}`);
}
function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function verifyOuterTools() {
  const modules = realpathSync(path.join(privateRoot, 'node_modules'));
  inside(privateRoot, modules);
  const receipt = readFileSync(path.join(path.dirname(entryPath), 'outer-tool-authority.sha256'), 'utf8');
  assert.equal(hash(receipt), receiptHash, 'Outer tool receipt differs from the reviewed proposal');
  const expected = new Map(receipt.trimEnd().split('\n').map((line) => {
    const match = /^([a-f0-9]{64})  (node_modules\/[a-z-]+\/.+)$/.exec(line);
    assert.ok(match, 'Invalid tool receipt row');
    assert.ok(!match[2].split('/').includes('..'), 'Tool receipt may not escape the owner');
    return [match[2], match[1]];
  }));
  assert.equal(expected.size, receipt.trimEnd().split('\n').length, 'Duplicate tool receipt path');
  const actual = [];
  for (const [name, version] of Object.entries(toolVersions)) {
    const root = path.join(modules, name);
    inside(modules, root);
    assert.equal(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version, version, `Wrong tool version: ${name}`);
    function walk(directory, relative = '') {
      for (const item of readdirSync(directory, { withFileTypes: true })) {
        if (item.name === 'node_modules') continue;
        const file = path.join(directory, item.name);
        const child = relative ? `${relative}/${item.name}` : item.name;
        if (item.isDirectory()) {
          walk(file, child);
          continue;
        }
        assert.ok(item.isFile(), `Unexpected tool file kind: ${file}`);
        inside(modules, file);
        const key = `node_modules/${name}/${child}`;
        assert.equal(hash(readFileSync(file)), expected.get(key), `Tool bytes changed: ${key}`);
        actual.push(key);
      }
    }
    walk(root);
  }
  assert.deepEqual(actual.sort(), [...expected.keys()].sort(), 'Tool package membership changed');

  const requireOwner = createRequire(path.join(privateRoot, 'package.json'));
  const publicEntry = realpathSync(fileURLToPath(import.meta.resolve('ts-dev-stack')));
  assert.equal(publicEntry, realpathSync(path.join(modules, 'ts-dev-stack/dist/esm/index.js')), 'Public callback API must use the private ESM entry');
  const dispatch = path.join(path.dirname(publicEntry), 'runCommand.js');
  const requireStack = createRequire(dispatch);
  for (const name of Object.keys(toolVersions)) {
    assert.equal(realpathSync(requireStack.resolve(name)), realpathSync(requireOwner.resolve(name)), `Stack and owner select different entries: ${name}`);
    assert.equal(realpathSync(requireStack.resolve(`${name}/package.json`)), realpathSync(path.join(modules, name, 'package.json')), `Stack selects an unreviewed package: ${name}`);
  }
  // This is the same resolver and basedir used by runCommand's install-fallback check.
  const resolveSync = requireStack('resolve').sync;
  for (const name of ['tsds-build', 'tsds-mocha']) {
    assert.equal(realpathSync(resolveSync(path.join(name, 'package.json'), { basedir: path.dirname(dispatch) })), realpathSync(path.join(modules, name, 'package.json')), `Public command existence check selects an unreviewed tool: ${name}`);
  }
}

async function runOuter(mode) {
  assert.equal(realpathSync(process.cwd()), privateRoot, 'Outer invocation requires the private package cwd');
  const pkg = JSON.parse(readFileSync(path.join(privateRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'backbone-mongo-migration-proof');
  assert.equal(pkg.source, 'src/index.ts');
  assert.ok(!existsSync(path.join(privateRoot, '.tsdsrc.json')), 'Unreviewed rc configuration');
  assert.ok(!pkg.tsds?.source && !pkg.tsds?.commands, 'Outer invocation forbids conflicting source or command remapping');
  for (const [name, version] of Object.entries(toolVersions)) {
    if (name === 'tsds-lib' || name === 'resolve') continue;
    assert.equal(pkg.devDependencies?.[name], version, `Root tool pin differs: ${name}`);
  }
  const config = { ...(pkg.tsds || {}), source: pkg.source };
  verifyOuterTools();
  const [command, args] = outerModes[mode];
  const errors = [];
  let calls = 0;
  // A callback never throws into runCommand's surrounding install-fallback catch.
  function duplicate() {
    process.exitCode = 2;
    errors.push(new Error('Outer public callback completed more than once'));
  }
  process.on('beforeExit', () => {
    if (calls !== 1) {
      process.exitCode = 2;
      process.stderr.write(`Outer callback count at terminal drain: ${calls}\n`);
    }
    if (calls > 1) process.stderr.write(`${inspect(errors, { depth: null, maxArrayLength: null, maxStringLength: null, showHidden: true, colors: false })}\n`);
  });
  try {
    await new Promise((resolve, reject) => {
      try {
        runCommand(command, args, { cwd: privateRoot, config }, (error) => {
          calls++;
          if (calls !== 1) {
            duplicate();
            return;
          }
          if (error !== undefined && error !== null) {
            errors.push(error);
            reject(error);
          } else resolve();
        });
      } catch (error) {
        errors.push(error);
        reject(error);
      }
    });
  } catch {
    // Raw operation values, including false/0, are retained in errors.
  }
  try {
    verifyOuterTools();
  } catch (error) {
    errors.push(error);
  }
  if (process.exitCode !== undefined && process.exitCode !== 0) {
    errors.push(new Error(`Outer process already has failure status ${process.exitCode}`));
  }
  if (errors.length) {
    process.exitCode = calls > 1 ? 2 : 1;
    process.stderr.write(`${inspect(errors, { depth: null, maxArrayLength: null, maxStringLength: null, showHidden: true, colors: false })}\n`);
    return;
  }
  assert.equal(calls, 1, 'Outer success requires one public callback');
  process.exitCode = 0;
  process.stdout.write(`[outer callback success] ${JSON.stringify({ mode, command, args, calls })}\n`);
}

let completed = false;
let terminalFailed = false;
let callbackFailurePresent = false;
let callbackFailure;
let postCallbackFatal = false;
let postCallbackExitFatal = false;
const terminalErrors = [];

process.on('uncaughtExceptionMonitor', () => {
  terminalFailed = true;
  process.exitCode = 2;
});

process.on('beforeExit', () => {
  if (terminalFailed) process.exitCode = 2;
});

function failTerminal(error) {
  if (terminalErrors.length === 0 && callbackFailurePresent) terminalErrors.push(callbackFailure);
  terminalErrors.push(error);
  terminalFailed = true;
  process.exitCode = 2;
  queueMicrotask(() => {
    try {
      if (process.connected) process.disconnect();
    } catch (disconnectError) {
      terminalErrors.push(disconnectError);
    }
    try {
      writeFileSync(2, `${inspect(terminalErrors, { depth: null, maxArrayLength: null, maxStringLength: null, showHidden: true, colors: false })}\n`);
    } catch (reportError) {
      throw new AggregateError([...terminalErrors, reportError], 'Compiler terminal failure reporting failed');
    }
  });
}

function complete(error) {
  if (completed) {
    failTerminal(new AggregateError([error], 'Compiler callback completed more than once'));
    return;
  }
  completed = true;
  callbackFailurePresent = error !== undefined && error !== null;
  callbackFailure = error;
  // Serialization and transport run after public dispatch, outside its callback catch.
  queueMicrotask(() => publishOutcome(error));
}

function publishOutcome(error) {
  if (terminalFailed) return;
  if (process.exitCode !== undefined && process.exitCode !== 0) {
    failTerminal(new Error(`Compiler process already has failure status ${process.exitCode}`));
    return;
  }
  const failed = callbackFailurePresent;
  try {
    const outcome = failed
      ? {
        type: 'compiler-callback',
        ok: false,
        error: {
          name: error instanceof Error ? error.name : 'NonErrorCallbackFailure',
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? (error.stack ?? '') : '',
          details: inspect(error, { depth: null, maxArrayLength: null, maxStringLength: null, showHidden: true, colors: false }),
        },
      }
      : { type: 'compiler-callback', ok: true };
    process.exitCode = 0;
    if (failed) writeFileSync(2, `${outcome.error.stack || outcome.error.details}\n`);
    if (!process.send) throw new Error('Compiler callback entry requires owned IPC');
    process.send(outcome, (sendError) => {
      if (sendError !== undefined && sendError !== null) {
        failTerminal(sendError);
        return;
      }
      try {
        if (process.connected) process.disconnect();
      } catch (disconnectError) {
        failTerminal(disconnectError);
        return;
      }
      if (postCallbackFatal && !terminalFailed) {
        setImmediate(() => {
          throw new Error('Owned compiler post-callback fatal');
        });
      }
      if (postCallbackExitFatal && !terminalFailed) {
        process.once('exit', () => {
          throw new Error('Owned compiler exit-listener fatal');
        });
      }
    });
  } catch (error) {
    failTerminal(error);
  }
}

const { tokens } = parseArgs({
  options: {
    ...Object.fromEntries(Object.keys(outerModes).map((mode) => [mode.slice(2), { type: 'boolean' }])),
    'post-callback-fatal': { type: 'boolean' },
    'post-callback-exit-fatal': { type: 'boolean' },
  },
  strict: true,
  allowPositionals: false,
  tokens: true,
});
assert.ok(tokens.length <= 1 && tokens.every((token) => token.kind === 'option'), 'Compiler invocation accepts at most one reviewed option');
const selection = tokens.find((token) => token.kind === 'option');
postCallbackFatal = selection?.name === 'post-callback-fatal';
postCallbackExitFatal = selection?.name === 'post-callback-exit-fatal';
if (selection && !postCallbackFatal && !postCallbackExitFatal) {
  await runOuter(`--${selection.name}`);
} else {
  try {
    runCommand('build', [], { cwd: process.cwd() }, complete);
  } catch (error) {
    failTerminal(error);
  }
}
