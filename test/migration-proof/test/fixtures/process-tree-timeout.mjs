import { spawn, spawnSync } from 'child_process';

const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? 'npm.cmd' : 'npm';
const child = spawn(npmCommand, ['run', 'test:lifecycle'], {
  detached: !isWindows,
  stdio: 'inherit',
});

const close = new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('close', (code, signal) => resolve({ code, signal }));
});

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

async function posixProcessTree(rootPid) {
  const command = spawn('ps', ['-axo', 'pid=,ppid='], { stdio: ['ignore', 'pipe', 'inherit'] });
  let stdout = '';
  command.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  const result = await new Promise((resolve, reject) => {
    command.once('error', reject);
    command.once('close', (code, signal) => resolve({ code, signal }));
  });
  if (result.code !== 0) throw new Error(`Outer ps exited ${result.code ?? result.signal ?? 'unknown'}`);
  const children = new Map();
  for (const line of stdout.trim().split('\n')) {
    const [pidText, parentText] = line.trim().split(/\s+/);
    const pid = Number(pidText);
    const parentPid = Number(parentText);
    const entries = children.get(parentPid) ?? [];
    entries.push(pid);
    children.set(parentPid, entries);
  }
  const tree = [];
  const visit = (pid) => {
    for (const childPid of children.get(pid) ?? []) visit(childPid);
    tree.push(pid);
  };
  visit(rootPid);
  return tree;
}

function taskkill(pid) {
  const result = spawnSync('taskkill.exe', ['/pid', String(pid), '/t', '/f'], { encoding: 'utf8', timeout: 5_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Outer taskkill exited ${result.status ?? result.signal ?? 'unknown'}: ${result.stderr}`);
}

async function terminateTree(pid) {
  if (isWindows) return taskkill(pid);
  const tree = await posixProcessTree(pid);
  for (const processId of tree) {
    try {
      process.kill(processId, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  await delay(250);
  for (const processId of tree) {
    if (processExists(processId)) process.kill(processId, 'SIGKILL');
  }
}

let timer;
const watchdog = new Promise((resolve) => {
  timer = setTimeout(async () => {
    try {
      if (child.pid !== undefined) await terminateTree(child.pid);
      const result = await Promise.race([close, delay(5_000).then(() => ({ closureTimedOut: true }))]);
      resolve({ timedOut: true, result });
    } catch (error) {
      resolve({ timedOut: true, error });
    }
  }, 30_000);
});

const outcome = await Promise.race([close.then((result) => ({ timedOut: false, result })), watchdog]);
if (timer) clearTimeout(timer);
if (outcome.timedOut) {
  console.error('Lifecycle test exceeded its 30 second outer process-tree timeout', outcome);
  process.exitCode = 124;
} else if (outcome.result.code !== 0) {
  process.exitCode = outcome.result.code ?? 1;
}
