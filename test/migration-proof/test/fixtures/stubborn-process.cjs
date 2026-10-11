const { spawn } = require('child_process');

const descendant = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {
  stdio: 'ignore',
});

process.on('SIGTERM', () => {});
descendant.once('spawn', () => {
  if (!process.send) throw new Error('Stubborn process fixture requires an IPC channel');
  process.send({ type: 'ready', descendantPid: descendant.pid });
});
setInterval(() => {}, 1000);
