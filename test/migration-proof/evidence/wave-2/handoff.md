# Wave 2 isolated history-preflight checkpoint

Date: 2026-09-10. Branch: `worktree-migration-prototype`. HEAD: `f631281d518bddedbe7780ec48d93efc26b51048`.

Proposed verdict: accept this as bounded private feasibility evidence for primary review. Do not port it to production or choose a locking strategy from it.

## Demonstrated behavior

- Every Mongo `create`, `status`, `up`, and `down` call ran in a separate built ESM child. The final run observed 14 distinct PIDs across successful, rejected, Promise, and callback paths. Every child reported its client closed, exited with code 0, emitted no signal, and was no longer live after the suite.
- Concurrent A/B `up` calls used separate databases and migration directories. A applied only `202609090001_baseline.js`; B applied only `202609090030_race.js`. Their data, status, down side effects, and native changelog rows remained separate.
- Mongo mutation preflight read the deployed `.js` names and the native `changelog` documents. It reconstructed native application order from numeric `migrationBlock` plus file order within a block. It rejected a missing applied file, a pending file before the last applied file, and a down history whose application order native `down` could not reproduce. Each rejection left the tested data and changelog unchanged.
- The SQL adapter selected `knex_migrations.id DESC`, read `202609090005_order_backdated.js`, and passed that exact name to `Knex.migrate.down`. The authored `backdated-down` write occurred and only `202609090010_order_new.js` remained in history.
- Post-write SQL and Mongo `up` failures produced `MigrationUncertainStateError`. The original runner error remained in `cause`; `completedIds` contained the successfully recorded migration before the failing body. The Mongo callback ran once, returned `void`, and omitted its result. The Promise form rejected. Each failing migration body wrote once, so the observed paths did not retry.
- The type consumer checks the shared facade's Promise return, callback `void` return, optional failure result, and uncertain-error fields. No root package export was added.

The implementation uses only Knex's migration table and migrate-mongo's changelog. It adds no ledger and performs no repair.

## Final evidence

- `nvu 22 npm run validate`: exit 0 on Node 22.23.2. Tsds checked 41 files with no fixes or warnings, built CJS and ESM, found no depcheck issue, confirmed the package was already sorted, and generated docs.
- `nvu 22 node test/fixtures/wave-2-process-tree-timeout.mjs`: exit 0. Four focused integration tests passed against real SQLite and MongoDB 8.2.6 under a 60-second process-tree watchdog. The expected SQL failure fixture printed its native failure lines during the passing uncertainty test.
- Structured evidence: `isolated-history-preflight.json`, SHA-256 `359940a45f45fe127f7267b0dd52258a64ca4159bfa9228715043f126061597c`.
- Raw test output: `wave-2-test.raw.log`, SHA-256 `a7ae0a715a91aedb887da8df3bcce3f68779dc986c5a8dbeb949de6216de9276`.
- Raw validation output: `wave-2-validate.raw.log`, SHA-256 `379519d63f5945d2e3efaa05563a7362651e08aacb133b38ff4abe117fc8ccce`.
- The raw `WAVE2_EVIDENCE` record equals the structured JSON. All 10 recorded source hashes match. The final record contains 14 observed process IDs, all unique and all closed.
- Exact dependency versions, resolved package metadata, source hashes, PIDs, database states, and native histories are in the structured evidence.

Development checks before the final evidence were not green and are not presented as evidence. The first validation formatted four new files and found type errors; a second found one typedoc type error. A later validation formatted 15 generated loader-cache JSON files after the cache was initially placed inside the proof package. The cache moved to the worktree root and that generated directory was removed. The first sandboxed database run failed before tests because loopback bind was denied. Two later real-database runs found the unawaited migrate-mongo lock-index/client-close interaction and the timestamp comparison error. The final commands above ran after those corrections.

## Preserved Gate 1 evidence

- All 14 report 23 evidence files, including generated Mongo and SQL migrations, match `/Users/kevin/Dev/Projects/knockback-v2/knockback-v2/reports/2026-09-09-23-migration-gate1-evidence/` byte-for-byte.
- All four report 25 supplemental evidence files match `/Users/kevin/Dev/Projects/knockback-v2/knockback-v2/reports/2026-09-09-25-migration-gate1-evidence/` byte-for-byte.
- All six source hashes recorded by the accepted process-ownership supplement still match the worktree. The prior 8/8 startup lock race was not regenerated or overwritten.
- Broad `npm test` was not run because its Gate 1 setup rewrites accepted evidence destinations. The focused Wave 2 suite used separate scratch and evidence paths.

## Limits and stop boundary

- Process isolation prevents migrate-mongo configuration cross-talk between the demonstrated A/B targets. It does not serialize two writers to one target and does not solve the accepted 8/8 race.
- The private worker sets migrate-mongo `lockTtl` to 0. Fast successful migrations otherwise leave migrate-mongo's unawaited TTL-index operation live when the owned client closes. This is not a production locking decision.
- Preflight is a time-of-check/time-of-use check outside write ownership. Another writer can change files or history after it passes. `migrationBlock` comes from `Date.now()`; concurrent writers can collide, and histories without a finite numeric block are rejected rather than repaired.
- The unsupported-down fixture writes valid migrate-mongo changelog documents directly to represent a previously admitted nonlexical history. Gate 1 separately retained the same order produced by the real native runner. No second history store was used.
- The run covers Node 22.23.2 on darwin-arm64. Linux, Windows, the package floor, engine sweeps, forced termination in the new operation-specific owner, interruption recovery, detached descendants, and Mongo server topologies beyond the disposable standalone remain unproven.
- No production code, production export, README, lock, automatic retry, upstream patch, shared tool, commit, merge, fetch, push, version, tag, publication, or deployment was changed or run.

Stop here for primary review before production integration or any locking decision.
