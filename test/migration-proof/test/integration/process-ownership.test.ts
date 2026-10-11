import assert from 'assert';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { cleanupScratch, closeOwnedRaceWorkers, type Evidence, prepareLifecycleScratch, processForceTerminationEvidence, processOwnershipIdentityEvidence, processSpawnFailureEvidence } from '../lib/proof.ts';

const evidence: Evidence = {
  commands: ['nvu 22 npm run test:lifecycle:guarded', 'nvu 22 npm run validate'],
};

describe('race worker process ownership', () => {
  before(async () => {
    await prepareLifecycleScratch();
    evidence.runtime = await processOwnershipIdentityEvidence();
  });

  after(async () => {
    await closeOwnedRaceWorkers();
    const evidenceDir = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), 'evidence');
    await mkdir(evidenceDir, { recursive: true });
    console.log(`GATE1_PROCESS_OWNERSHIP_EVIDENCE=${JSON.stringify(evidence)}`);
    await writeFile(path.join(evidenceDir, 'gate-1-process-ownership.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    await cleanupScratch();
  });

  it('treats error plus close without exit as a failed launch', async () => {
    evidence.spawnFailure = await processSpawnFailureEvidence();
    assert.equal((evidence.spawnFailure as { originalErrorPreserved?: boolean }).originalErrorPreserved, true);
  });

  it('force-terminates and awaits a process tree that ignores graceful termination', async () => {
    evidence.forceTermination = await processForceTerminationEvidence();
    assert.equal((evidence.forceTermination as { escalated?: boolean }).escalated, true);
  });
});
