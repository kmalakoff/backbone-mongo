# Gate 1 process-ownership resubmission

Proposed verdict: **ACCEPT the two final process-ownership corrections and close Gate 1.** Do not start the next migration API slice without owner approval. This verdict does not approve production process isolation or a lock strategy.

## Report 23 checklist

1. A failed spawn is now a terminal `failed-launch` state. The real ENOENT regression records no PID, no exit event, and close code `-2`. It preserves the original Node `Error` object, including `code`, `path`, and `syscall`. Errors emitted after the `spawn` event use a separate `postSpawnErrors` path and fail the active ready/result wait without being relabeled as launch failures.
2. Cleanup first sends a graceful process-tree termination. After a bounded grace period, it escalates to `SIGKILL` for a POSIX process group or `taskkill /t /f` on Windows. It then awaits the direct child's exit and stream closure. `Promise.allSettled` waits for every owned child, and aggregate cleanup errors retain their original failure objects.
3. An owned-process registry drains before either integration teardown closes Mongo or removes scratch. If forced termination cannot close a live child, teardown stops. The guarded test runner has an independent 30-second process-tree timer. On POSIX it enumerates descendants before termination so nested process groups remain covered; on Windows it uses `taskkill /t /f`.
4. The real stubborn-process regression starts a parent and descendant that ignore `SIGTERM`. The active result wait times out, cleanup escalates, the direct child reports `SIGKILL` for both exit and close, and the test confirms both PIDs are gone. The early malformed-child helper now uses the bounded cleanup outcomes attached to the initiating error and has no second unbounded exit wait.
5. All 14 files preserved by report 23 still match the worktree copies byte-for-byte. The accepted database, generated-create, facade, type, rollback, and 8/8 race evidence was not regenerated.

## Evidence

- Report 23: `/Users/kevin/Dev/Projects/knockback-v2/knockback-v2/reports/2026-09-09-23-migration-gate1-correction-review.md`
- Preserved report 23 snapshot: `/Users/kevin/Dev/Projects/knockback-v2/knockback-v2/reports/2026-09-09-23-migration-gate1-evidence/`
- Supplemental structured evidence: `/Users/kevin/Dev/Projects/knockback-v2/backbone-mongo/.worktrees/migration-prototype/test/migration-proof/evidence/gate-1-process-ownership.json`
- Supplemental raw test output: `/Users/kevin/Dev/Projects/knockback-v2/backbone-mongo/.worktrees/migration-prototype/test/migration-proof/evidence/gate-1-process-ownership-test.raw.log`
- Supplemental raw validation output: `/Users/kevin/Dev/Projects/knockback-v2/backbone-mongo/.worktrees/migration-prototype/test/migration-proof/evidence/gate-1-process-ownership-validate.raw.log`
- Process fixture: `/Users/kevin/Dev/Projects/knockback-v2/backbone-mongo/.worktrees/migration-prototype/test/migration-proof/test/fixtures/stubborn-process.cjs`
- Outer timeout runner: `/Users/kevin/Dev/Projects/knockback-v2/backbone-mongo/.worktrees/migration-prototype/test/migration-proof/test/fixtures/process-tree-timeout.mjs`
- Regression suite: `/Users/kevin/Dev/Projects/knockback-v2/backbone-mongo/.worktrees/migration-prototype/test/migration-proof/test/integration/process-ownership.test.ts`

The raw evidence record equals the structured JSON. All six source hashes in that JSON match the corrected files. No stubborn worker, descendant, Mongo worker, or failed-spawn process remained after the run.

## Commands

- `nvu 22 npm run validate`: exit 0. Tsds validation checked 31 files with no fixes or warnings, built CJS and ESM, found no depcheck issue, and generated docs.
- `nvu 22 npm run test:lifecycle:guarded`: exit 0. Both real subprocess regressions passed in about one second under the independent process-tree timer.

No production code, preflight, isolation facade, lock, upstream/shared tool, commit, merge, version, push, release, or publication operation was performed.
