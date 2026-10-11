# Wave 2 correction resubmission

Date: 2026-09-10. Branch: `worktree-migration-prototype`. HEAD: `f631281d518bddedbe7780ec48d93efc26b51048`.

Proposed verdict: accept the corrected private Wave 2 feasibility checkpoint for primary review. Do not move this code into production or select a locking strategy from this result.

## Corrections

- The Mongo owner now resolves `dist/esm/workers/mongo-operation.js` from a TypeScript source caller, a built ESM caller, or a built CJS caller. The integration suite loaded the actual emitted ESM and CJS modules. Each completed `up`, `status`, and `down` against its own real Mongo database. Both recorded the emitted ESM worker as the child entry, changed the expected data and native changelog, and reverted the recorded migration.
- The IPC schema retains a bounded history-inspection error with only `name`, `message`, and optional `stack`. It separately retains a validated string array from the runner's `migrated` field. The deserialized cause types both fields. It does not serialize arbitrary cause properties.
- `MigrationUncertainStateError.historyInspected` distinguishes a successful history read from an unavailable read. When the post-failure read succeeds, `completedIds: []` means the inspected history found no completion. When the read fails, the worker sets `historyInspected: false`, keeps the typed diagnostic, and uses the runner's validated migrated IDs.
- A pure-value unit test roundtrips the runner error, migrated IDs, and nested history error. It checks exact name, message, and stack values and proves unrelated top-level and nested fields do not cross the serialization boundary.
- A real Mongo migration wrote `history-unavailable-write`, closed the operation client, and threw. The worker could not inspect the changelog afterward. The caller received the original migrate-mongo cause, `MongoNotConnectedError: Client must be connected before running operations`, `historyInspected: false`, and completed ID `202609090001_baseline.js`. The authored write occurred once and native history contained that baseline ID, so the observed path did not retry.

The prior A/B isolation, raw preflight rejections, SQL application-last down, normal uncertain-state, callback, Promise, and no-retry cases remain in the focused suite.

## Final commands and results

- `/bin/zsh -o pipefail -c 'nvu 22 npm run validate 2>&1 | tee evidence/wave-2-resubmission/wave-2-resubmission-validate.raw.log'` exited 0 on Node 22.23.2. Tsds checked 43 files with no fixes or warnings, built CJS and ESM, found no dependency issue, confirmed package ordering, and generated docs.
- `nvu 22 node test/fixtures/wave-2-process-tree-timeout.mjs` exited 0. Eight tests passed in four seconds against real SQLite and MongoDB 8.2.6 under the 60-second process-tree watchdog. The two Knex failure lines were expected output from the passing uncertainty fixture.
- The first sandboxed focused run exited before Mongo tests because the sandbox refused the disposable server's `0.0.0.0` bind with `EPERM`. Both pure serialization tests passed in that run. The approved loopback run above supplied the real-database result. One later command did not start because its workdir contained a typographical error; it produced no repository or test evidence.
- The raw `WAVE2_EVIDENCE` JSON equals the structured file. All 12 recorded source hashes and all three recorded built-file hashes match the current files.
- The final record contains 21 distinct observed child PIDs. No PID remains live. Every observation reported an opened and closed client, exit code 0, no signal, and the emitted ESM worker path.

Environment: Node 22.23.2, darwin-arm64, MongoDB 8.2.6. Exact dependency versions, resolved package metadata, source hashes, built hashes, process observations, database states, and native histories are in the structured evidence.

## Fresh evidence

- Structured result: `built-callers-history-diagnostics.json`, SHA-256 `34108fef2f03525a841107d268e0edbb000632dcbcf3bc19643920d61e7d3966`.
- Raw test bytes: `wave-2-resubmission-test.raw.log`, SHA-256 `4c36c74e5823dcf12064c8417ee502213ad3841b9874969ab3843cc639af285f`.
- Raw validation bytes: `wave-2-resubmission-validate.raw.log`, SHA-256 `51a5861318c6567d82ba3b963f1b009d6259248320fe3e1d09b58d6a905daad8`.
- Built CJS caller: `dist/cjs/next/isolated-mongo.js`, SHA-256 `cbc49a0241fcdee5c924fe8ab18ed5d9c60939c54324dabd0bd632429eb856fa`.
- Built ESM caller: `dist/esm/next/isolated-mongo.js`, SHA-256 `968540838c4dbf22a64afc9fa6506aa534ec06554b634757c50647ec15f168cd`.
- Built ESM worker: `dist/esm/workers/mongo-operation.js`, SHA-256 `1964e26c21e1026be4cac2a8517fbf4495106e8f720d3d7202898e74bf2fa6ab`.

## Preserved evidence

- The four report 23 files and all ten generated migration files match the accepted report 23 copies byte-for-byte.
- The four accepted report 25 process-ownership files match their report copies byte-for-byte. All six source hashes recorded in that supplement match the worktree.
- The accepted 8/8 startup lock race evidence was not regenerated or overwritten.
- The initial Wave 2 structured file still hashes to `359940a45f45fe127f7267b0dd52258a64ca4159bfa9228715043f126061597c`. Its handoff still hashes to `eac63cf1d1417f3d676af2fe94c2c220bc121a2f8a59ad159c4341bbe768e5e7`, and its validation log still hashes to `379519d63f5945d2e3efaa05563a7362651e08aacb133b38ff4abe117fc8ccce`.
- The restored initial `wave-2-test.raw.log` is the primary's normalized text copy and hashes to `78e4eeeaf24b2a6139ee6aeaed53a9856d5eb10363bae9801bdf71bd620b5fdf`. This resubmission does not claim that file has the original submitted raw hash. The fresh raw bytes listed above are the resubmission test record.
- Broad `npm test` was not run because Gate 1 `prepareScratch()` rewrites accepted evidence locations. The focused suite wrote only its separate scratch and `evidence/wave-2-resubmission` paths.

## Limits and stop boundary

- This remains a private, lock-free isolation experiment. The worker still sets migrate-mongo `lockTtl` to 0 to avoid its unawaited TTL-index operation during fast client closure. This is not a production lifecycle result with locking enabled.
- Process isolation prevents the demonstrated configuration cross-talk. It does not serialize writers to one target and does not solve the accepted 8/8 startup race.
- Mongo preflight remains a time-of-check/time-of-use check outside write ownership. The controlled single-writer condition belongs only to these disposable fixtures.
- The failure test proves the handled runner-error path when the migration closes its client. It does not prove uncertainty metadata for abrupt process death after a write. Forced termination, interruption, and detached-descendant behavior in the new owner remain unproven.
- Only Node 22.23.2 on darwin-arm64 and a disposable standalone Mongo server ran. Linux, Windows, the package floor, engine sweeps, and other Mongo topologies remain unproven. Migration-block ties, clock regression, and arbitrary admitted histories also remain unresolved.
- No production source, root export, README, lock, repair ledger, automatic retry, upstream patch, shared tool, commit, merge, fetch, push, version, tag, publication, or deployment changed or ran.

Stop here for primary review before production integration or any locking decision.
