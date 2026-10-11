# Gate 1 correction resubmission

Proposed verdict: **ACCEPT the corrected Gate 1 proof as bounded feasibility and risk evidence.** Do not advance to the next API slice without owner approval. The reproduced 8/8 duplicate Mongo execution proves that process isolation alone is not single-writer protection; no lock strategy is proposed or approved here.

## Review checklist evidence

1. Child ownership: `test/lib/proof.ts` owns readiness, IPC send, result, explicit `exit`, stream `close`, and per-phase timeout. Every failure path sends `SIGTERM` to remaining children and awaits all exit/close outcomes with `Promise.allSettled`. The early-failure case records one malformed child exiting 1 and its sibling being terminated and awaited. Successful workers close their Mongo client before sending a `clientClosed: true` result; the parent awaits all eight exits before querying Mongo.
2. Actual generated files: both native `create` operations use typed backend templates. Their exact generated TypeScript is copied into a scratch package, built and typechecked through the house `tsds build` entry point, and the emitted JavaScript is executed by the real runner. The generated source, declaration, JavaScript, package, and tsconfig are retained below. No direct `tsc` or compiler-API path exists.
3. Facade parity: real Knex runner inputs cover callback and Promise success/error behavior for `create`, `status`, `up`, and `down`. Assertions cover return shape (`Promise` versus `undefined`), equal results/errors, optional failure results, and once-only callbacks. The positive and expected-error TypeScript consumer is `test/types/facade-consumer.ts`. `test/unit/worker.test.ts` covers synchronous invocation failure for all four operations and proves a throwing consumer callback is not caught and called again.
4. State assertions: SQL and Mongo authored ordering migrations assert the exact `new-up`, `backdated-up`, `new-down` rows. Mongo down asserts the `widgets` collection no longer exists. SQL up/down failure cases and Mongo up failure retain the original runner error together with partial data and history.
5. Reproduction identity: the structured evidence records Node/platform, exact package versions/resolved URLs/integrities, package and authored-source SHA-256 values, generated source/deployed SHA-256 values, commands, Mongo server identity, and raw results.

## Exact evidence paths

- Structured result: `/Users/kevin/Dev/Projects/knockback-v2/backbone-mongo/.worktrees/migration-prototype/test/migration-proof/evidence/gate-1.json`
- Test raw output: `/Users/kevin/Dev/Projects/knockback-v2/backbone-mongo/.worktrees/migration-prototype/test/migration-proof/evidence/gate-1-test.raw.log`
- Validation raw output: `/Users/kevin/Dev/Projects/knockback-v2/backbone-mongo/.worktrees/migration-prototype/test/migration-proof/evidence/gate-1-validate.raw.log`
- SQL generated source: `/Users/kevin/Dev/Projects/knockback-v2/backbone-mongo/.worktrees/migration-prototype/test/migration-proof/evidence/generated/sql/20260910051707_created_by_knex.ts`
- SQL generated JavaScript: `/Users/kevin/Dev/Projects/knockback-v2/backbone-mongo/.worktrees/migration-prototype/test/migration-proof/evidence/generated/sql/20260910051707_created_by_knex.js`
- SQL generated declaration: `/Users/kevin/Dev/Projects/knockback-v2/backbone-mongo/.worktrees/migration-prototype/test/migration-proof/evidence/generated/sql/20260910051707_created_by_knex.d.ts`
- Mongo generated source: `/Users/kevin/Dev/Projects/knockback-v2/backbone-mongo/.worktrees/migration-prototype/test/migration-proof/evidence/generated/mongo/20260910051707-created_by_migrate_mongo.ts`
- Mongo generated JavaScript: `/Users/kevin/Dev/Projects/knockback-v2/backbone-mongo/.worktrees/migration-prototype/test/migration-proof/evidence/generated/mongo/20260910051707-created_by_migrate_mongo.js`
- Mongo generated declaration: `/Users/kevin/Dev/Projects/knockback-v2/backbone-mongo/.worktrees/migration-prototype/test/migration-proof/evidence/generated/mongo/20260910051707-created_by_migrate_mongo.d.ts`

## Commands and results

- `nvu 22 npm run validate`: exit 0; Biome checked 28 files with no fixes, dual CJS/ESM builds completed, export ordering and depcheck passed, and TypeDoc completed.
- `nvu 22 npm test`: exit 0; 8 passing against SQLite and MongoDB 8.2.6/WiredTiger.
- Each actual generated migration ran `/Users/kevin/.nvu/installed/v22.23.2/bin/node .../node_modules/ts-dev-stack/bin/cli.js build`; exact command and stdout are in `gate-1.json`.
- Mongo race result: 8 successful distinct PIDs, 8 data rows, 8 history rows, 0 lock rows, all clients closed before result, and all child exits were code 0.

## Standards conformance and bounded variants

- Coding standards: the proof remains a private package with a small backend-neutral facade and injected operations; no production export, isolated-process facade, upstream patch, or production metadata change was made. ESM and CJS package export smoke tests remain present.
- Testing standards: unit behavior lives in `test/unit`, package consumers live in `test/exports` and `test/types`, and database-backed behavior stays in `test/integration`. Real SQLite and MongoDB are used rather than mocked runners. Scratch data and the Mongo binary cache stay under the repository `.tmp` tree.
- Releasing standards: the fixture remains private at `0.0.0`. No commit, merge, version, changelog, tag, release, or publication command was performed.
- Justified prototype/database variants: the Mongo worker is proof-only because migrate-mongo has mutable process-global configuration and its CommonJS surface is Promise-valued rather than directly callable. SQL `transaction: false` appears only in authored failure probes so partial data/history can be observed. MongoDB 8.2.6/WiredTiger and SQLite are deliberate real-engine test variants. Evidence is retained inside the already authorized private proof rather than added to production packages.
- Origin note: the owner-directed ORM-family origin is `kmalakoff`; existing local production metadata was intentionally left unchanged because production integration and release changes are outside this authorization.
