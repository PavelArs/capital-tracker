# Verification record — record-asset-swaps (in progress)

## Baseline and design review

- Root inspected AGENTS, target brief, continuity, actual Git diff, canonical specs,
  OpenSpec1.2.0 help/list/config and existing CI/CD. Base70d33bb; only owner Nginx edit.
- Retain exact connected FIFO/revision/immutable-command infrastructure; extend source
  unions/replay and typed consumers; do not replace pipeline or remove data/folders.
- Actual baseline command: `pnpm --dir backend test --runInBand --coverage=false
  asset-reward fifo historical-accounting trade-input csv owned-transfer-input
  historical-valuation manual-portfolio-valuation valuation-history`.
  Exit0,385tests/16suites,2.892s; `/private/tmp/capital-swaps-baseline.log`.
- Sol independent architecture/oracle review identified older incoming-asset lots as a
  fee-provenance hazard. Contract now explicitly separates held-before-acquisition versus
  incoming-original-prefix fees. Sol confirmed conservation and exact independent45/49.9
  results; Luna separately reviewed existing UI/retry surfaces and two critical journeys.
- Full before-product contract committed e83fe0c; isolated worktrees swap-core (Sol) and
  swap-contract (Luna). Root owns migration/dependencies/deployment/Docker integration.

## Execution

Actual preproduct pure RED: Sol test-only a17c399, ten cases all failed behaviorally
against the existing projector (ignored swaps/absent acquired inventory), no missing-module
or TypeScript failure. `/private/tmp/capital-swap-pure-red.log`. Root reviewed exact
oracles and requested stronger correct nested-provenance/full allocation expectations
before product implementation; those shape corrections do not change financial results.
Amended94b5b1b integrated asdf0fd17:10/10behavioral RED repeated,
`/private/tmp/capital-swap-pure-red-amended.log`, tsc/Biome passed. Root reviewed corrected
allocation ordering/nested provenance. Delta reviews64ae4c9/4da2913 integrated0cf55f2/e8a46e8;
source-basis versus consideration restatement clarified,15200original-origin bound and
swap-origin UI explicit. Root strict change validation passed after integration.

Actual preproduct HTTPS RED: `caffeinate -is node /private/tmp/capital-swaps-red.cjs`,
exit1. Fresh schema21 migration/seed, artifact checks, real password/MFA and two real
backend replicas/PostgreSQL succeeded. `SWAP-API` validPOST expected201 received404;
`SWAP-UI` failed because the `Обмены активов` region is absent. Exactly2cases,1Chromium
worker,0retries. `/private/tmp/capital-swaps-https-red.log`, traces/screenshots in
`/private/tmp/capital-swaps-red-artifacts`. All synthetic labeled containers/networks
were removed; no production/data/provider mutation. Tested predecessor images:

- BE `sha256:176f668b0c6a77e78961600a3b989446f2bd479a8bcbd9a933142b8e5684d25f`
- FE `sha256:fe42b103d5daf60de1ad13c2415defbbf0f948e5398ef37e627763e489a7069e`

Strict noUnused E2E TypeScript and scoped Biome pass for the new HTTPS tests. Owner
Nginx SHA256115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432 and
lock SHA2566a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d unchanged.

## Partial implementation and actual scoped GREEN

Sol implemented pure core in its worktree, with10/10new and89/89selected pure retained
cases passing. Root reviewed the full diff against the independent oracles and finalized
the stopped agent's changes5921050, integrated0e06fa9. Luna parser/tests68b4630 integrated
6450a57; root requested reuse of existing exact atom conversion. Agent made the cleanup
and strengthened precision tests before hitting quota; root reviewed/finalized93c9f93,
integrated8d0f54c. Both agents are terminal/quota-limited untilSep30; no repeated invocation
or paid fallback. Root removed only their known temporary dependency symlinks; trees clean.

Root implementation6658dbc adds schema22/store/service/controller and connected loading,
trade/historical/series projections. The schema is additive only. API/root persistence
postimplementation independent review remains pending; do not treat pure-core review as
covering persistence or UI. The later frontend checkpoint is recorded below.

- Root relevant Jest command adds `asset-swap` to the baseline selection: exit0,
  **403tests/18suites**,3.439s, `/private/tmp/capital-swaps-unit-green.log`.
- Backend Nest build passed; `/private/tmp/capital-swaps-backend-build.log`.
- Changed18backend files scoped Biome passed. First invocation expanded a glob from the
  wrong cwd and did not run; rerun frombackend passed, no suppressed code failure.
- Actual backend release image build passed, `/private/tmp/capital-swaps-backend-image.log`:
  **sha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2**, source6658dbc.
- `caffeinate -is node /private/tmp/capital-swaps-pg.cjs` exit0 on that image,
  `/private/tmp/capital-swaps-pg-attempt1.log`: fresh22 and all3currently implemented PG
  families pass (connected correction/recipient FIFO/retained receipts/invalidvoid;
  incoming-vs-held fee/null-vs-zero/complete pinned allocation/terminal lifecycle;
  actual deferred COMMIT witness/full rollback/reusablekey/privatevalidation).
  This does NOT establish populated21upgrade, full SQL constraints, process races,
  capacity/snapshot/CSV/once-only-load verification; these required cases remain pending.

The change is not complete or ready to archive. Further PG/migration/bounds acceptance,
independent persistence/UI review and remaining task5gates are unrun/incomplete. See tasks.md;
no full-suite or release claim is made.

## HTTPS API and retained runtime checkpoint

- `caffeinate -is node /private/tmp/capital-swaps-api-green.cjs` exit0;
  `/private/tmp/capital-swaps-api-attempt1.log`. Exactly **SWAP-API1/1 passed13.3s**,1Chromium
  worker,0retries, same BEdd90a8c5 image and predecessor FEfe42b103 image. Real fresh22,
  release artifact/proxy checks, actual password/MFA/backend/PG. Tests assert exact held-lot
  preservation, incoming fee, null→0correction, terminal void, immutable replay, source
  protection/Origin/CSRF/generic404/no-store/no-business-mutation/no-provider-request.
  This checkpoint covered API only; later SWAP-UI GREEN is recorded below.
-20retained fixture expectations updated to schema22; predecessor17→22 applies5,
  19→22 applies3,20→22 applies2. Only new swap tables added to migration preservation
  exclusions with explicit emptiness checks; existing rows, financial/auth assertions
  and original predecessor schema construction preserved. Main swap PG fixture added
  to the shared acceptance runner. Twenty changed CJS fixtures passed node syntax;
  new main swap fixture also passed scoped Biome after formatting/split declaration.
- Retained runtime attempt1 exited1 after6reward families passed. Old reward capacity
  query matcher matched both actual reward and new swap capacity SELECTs, reporting2
  instead of1. Root corrected the matcher to identify each table, keeping exact1per-table
  preflight assertions, and added exact1swap materialization even for empty history.
  No product or financial assertion changed. `/private/tmp/capital-swaps-retained-attempt1.log`.
- Retained attempt2 `caffeinate -is node /private/tmp/capital-swaps-retained.cjs` exit0,
  `/private/tmp/capital-swaps-retained-attempt2.log`: all7reward families and all retained
  transfer families pass, including actual transfer process/advisory/CAS/passive budgets,
  owner bounds, connectedCSV, RR snapshots and deferredCOMMIT. Fresh22/populated20 and19
  preservation pass. Selected `migrations.cjs --from18` passes fresh22/populated18 with
  authentic encrypted MFA/recovery/session/admission/financial/schema preservation.
  Swap-specific process/budget/SQL-constraint/populated21 checks remain pending.
- Backend full lint exit0 with77existing warnings; `/private/tmp/capital-swaps-backend-lint.log`.
  Shared-runner engineering gate **183tests/2suites PASS5.961s**,
  `/private/tmp/capital-swaps-engineering.log`. Strict all-spec validation **29items PASS**
  (28canonical+1active), `/private/tmp/capital-swaps-specs.log`. No dependency/FE build/audit/
  full E2E/hostedCI/release/production claim in this checkpoint; inherited proxyhttp2 and
  test-runner color warnings remain. Those required final gates stay unchecked.
- Final labeled synthetic container/network inventories empty. Nginx/lock hashes above
  unchanged; only owner Nginx remains outside task commits. No realDB, deployment, push,
  paid fallback, original-repository movement or project-folder deletion.

## Reviewed owner workflow implementation checkpoint (2026-09-24)

Root implemented the frontend in11aa6ef after the recorded real SWAP-UI RED. Pending
backend/fixture evidence was first committed d7889bd. New API types include local and
transferred swap origins; current/historical results label actual USD sales separately
from swap consideration, consumed basis, fee basis and realized evidence. The normalized
review, immutable receipt, paged saved history and pinned current allocation remain
separate. Fee source and asset UUIDs are explicit. Lost responses preserve the exact
owner/account command across SPA remount, input/refresh generations invalidate reviews,
and the trade draft survives swap mutations. No package, lock, migration or deployment
configuration changed in this frontend checkpoint.

Actual checks:

- Frontend build exit0, TypeScript/Vite; existing bundle>500kB warning retained.
  `/private/tmp/capital-swaps-frontend-build.log`.
- Frontend full Vitest at the initial editor checkpoint: **106tests/16files PASS3.28s**,
  `/private/tmp/capital-swaps-frontend-unit.log`. Three later static presentation/control
  tests plus the three draft tests: **6/6 PASS1.06s** in2files, no own API/auth mocks,
  `/private/tmp/capital-swaps-ui-evidence-tests.log`. They verify tiny fee amounts,
  same-symbol UUIDs, known0/null totals and swap-origin transfer intervals.
- Full frontend lint exit0 with the same27existing warnings; changed15files scoped Biome
  passed. Draft tests preserve exact numeric comparisons beyond binary precision, UTC
  normalization, fee coupling and rejected invalid fields. Root self-reviewed async
  generations, recovery storage and provenance branches; this is NOT independent review.
- Actual frontend image build exit0, source11aa6ef product tree:
  **sha256:7eff01d148e8f286c025655ffa0dd88cfa842fc051d9dd9240318c11cc60768c**,
  `/private/tmp/capital-swaps-frontend-image.log`. Backend remained the actual dd90a8c5
  image above. Image built before the final supplemental test-only fixture fixes;
  compiled product source matches11aa6ef.
- `caffeinate -is node /private/tmp/capital-swaps-ui-green.cjs` exit0,
  `/private/tmp/capital-swaps-ui-green-attempt1.log`, artifacts
  `/private/tmp/capital-swaps-ui-green-artifacts`: **7/7 PASS1.7m**,1Chromium worker,
  zero retries. Real fresh22/seed/artifact checks/HTTPS/password/MFA/PG/two replicas.
  Exact selection: SWAP-API, SWAP-UI, REWARD-UI, TRANSFER-UI, VAL-UI,
  TRADE-003-A/TRADE-006-A primary form and CSV-006-A full Russian import/replay/rollback.
  Main swap editor case passed11.9s, including real committed response loss plus identical
  retry after navigation, exact allocation/original lot display, null→0 correction,
  terminal void and separate draft preservation. A delayed actual versions response
  was delivered after a concurrent real trade advanced the pin and a list refresh;
  it could not restore stale review or enable submission. route.fetch exercised the real
  backend; only transport delivery was delayed/aborted. Existing CSV/trade selectors
  changed only for the clearer USD-sale result label, retaining every exact amount.
- Strict E2E TypeScript exit0 using backend TypeScript with --noEmit --strict
  --noUnusedLocals --noUnusedParameters --skipLibCheck --target ES2022 --module commonjs
  --moduleResolution node --esModuleInterop --types node --typeRoots ./node_modules/@types
  ../tests/e2e/*.ts; `/private/tmp/capital-swaps-ui-e2e-types2.log`.
- `pnpm audit:production` exit0,2existingmoderate/nohighcritical,
  `/private/tmp/capital-swaps-production-audit.log`; lock unchanged. Strict OpenSpec
 29items passed, `/private/tmp/capital-swaps-ui-specs.log`.

Failed local preparation attempts were not claimed as successful checks: an initial
TypeScript error exposed an obsolete narrowed review ref after making refresh always
invalidate review; root removed the redundant ref/condition. Biome flagged JSX punctuation
in allocation text, corrected without changing values. Two helper-edit invocations used
wrong working-directory paths and made no requested edits; reruns used the correct paths.
An attempted E2E tsconfig path did not exist; the explicit command above passed instead.
The later supplemental component test initially omitted required Instrument metadata and
used Playwright's unsupported `exact` option with Testing Library. This produced3tscerrors
in `/private/tmp/capital-swaps-frontend-types-final.log`; no product error or assertion
was hidden. Complete static metadata and the exact string role name fixed the fixture;
final tsc exit0 plus **3/3 supplemental tests PASS1.01s** are recorded in
`/private/tmp/capital-swaps-frontend-types-final2.log` and
`/private/tmp/capital-swaps-ui-evidence-tests2.log`. No second full suite was needed for
these test-only fixes. The previous compound shell wrapper returned its last command's
status; this record uses the actual compiler output and subsequent set-e verification.

All exec sessions completed and labeled synthetic container/network inventories were
empty after cleanup. Owner Nginx and lock SHA256 above remain unchanged. No production,
push, provider request from accounting, paid fallback or project movement/removal.
Agents remain quota-limited; no retry or new paid-model fallback was attempted.
Tasks4.1/4.2 are now complete, **6/12** total. Remaining requirements include populated21
preservation/fullSQLconstraints, swap-specific real process/cap/coherent-snapshot/CSV/
once-only nonempty-load gates and independent persistence/UI review. Final verification
and archive remain unchecked. Full unrelated suites/hostedCI/release/backup/security
matrix and broader target requirements are not claimed complete.

## Schema22 preservation and SQL checkpoint — 2026-09-26

Task3.1 is now complete, **7/12** total. This increment adds acceptance coverage
for the already implemented additive migration; no product behavior, dependency,
deployment configuration or image changed. No artificial RED was manufactured.
The owner-required complete frontend redesign is separately tracked in
docs/frontend-redesign-plan.md and the target brief, committed asbe35646.

Actual command `caffeinate -is node /private/tmp/capital-swaps-schema22.cjs` exited0,
log `/private/tmp/capital-swaps-schema22-attempt1.log`. Harness used only disposable
`capital-tracker-e2e` PostgreSQL16.10 and the existing backend release image
**sha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2**.
It ran the following fixtures in real release containers, mounting tests read-only:

- `node /tests/asset-swaps-db.cjs`: **4/4 families PASS**. Retained connected
  economics, fee/evidence/lifecycle and actual deferred COMMIT rollback witness
  passed again. New SWAP-006 covers **55 direct SQL refusals**, requiring specific
  SQLSTATE23514/23503/23505/23502/22003 and unchanged fingerprints across every table.
  Covers positive finite principal/fee/consideration constraints, nullable evidence,
  48-digit integer capacity, chronology, version/kind bounds, explicit fee coupling,
  foreign/missing instruments/heads, request/revision/version uniqueness, deferred
  current-head linkage and restricted deletion. Positive transactional probes accept
  null, known0, exact30fractional digits, full incoming fee and tiny held fee. All
  probes roll back; parser precision and immutable API semantics remain separate.
- `node /tests/migrations.cjs --from21`: missing configuration refusals, fresh22/
  populated no-op and **native populated21→22 preservation PASS**. Shared native
  predecessor fixtures retain both owners' legacy financial rows, authentic encrypted
  active/candidate MFA and recovery states, all session classes/admissions, opening,
  trades, CSV bytes/receipts, carry-in, flows and manual prices. New helper also seeds
  exact display FX plus source rewards and owned transfers for both owners. Actual
  post-upgrade services return identical original receipt values with stale
  original pins; transferred reward origin and exact50USD remaining basis in each
  account are preserved. Both new swap tables stay empty; every preceding schema
  object and row is unchanged, with only the new migration record/sequence added.
  Repeated CLI execution is identical; explicit migration22 downgrade refusal
  preserves the full snapshot. Default full migration runner includes21 now.

All three changed CJS files pass `node --check`; `git diff --check` passes. Scoped
Biome on the main swap fixture and new helper passed after formatting and splitting
two multi-variable declarations flagged by the first lint invocation; no financial
assertion changed. Log `/private/tmp/capital-swaps-schema22-style.log`. Existing
large migrations.cjs retains its surrounding style to avoid unrelated formatting.
`OPENSPEC_TELEMETRY=0 openspec validate --all --strict --no-interactive` passed
**29/29**, `/private/tmp/capital-swaps-schema22-specs.log`.

Actual final Docker inventories contained no e2e-labeled containers/networks.
Separate preview containers were already stopped29hours earlier; their durable
`capital-tracker-preview_preview_data` volume is present. No preview restart/reset
or volume removal occurred. Nginx/lock hashes match the protected values above.

Root reviewed fixture construction, SQL oracles and preservation comparisons; this
does not complete pending independent persistence/UI review. Quota-limited agents
were not retried. Swap-specific two-process races/capacity/coherent snapshots/CSV/
once-only loads, final delivery gates and archive remain pending. Browser checks,
builds, full suites, older predecessor matrix, dependency audit, hosted CI and
release/backup/security gates were not repeated for these test-only changes; the
previous scoped results remain dated evidence, not new claims.

## Connected runtime and bounds checkpoint — 2026-09-26

Tasks3.2/3.3 now complete, **9/12** total. Added only PG acceptance and runner
integration; implementation and release images are unchanged. Native bulk fixtures
prepare large histories only; real production services execute all boundary writes,
refusals, replay and reads. No own backend/repository/auth response is mocked.

- `caffeinate -is node /private/tmp/capital-swaps-bounds.cjs` first exited0 with
 4families, `/private/tmp/capital-swaps-bounds-attempt1.log`. After adding component
  preflight and wide allocation coverage, the same command exited0 with **6/6**,
  `/private/tmp/capital-swaps-bounds-attempt2.log`. Four race variants use separate
  Node and PostgreSQL PIDs, an actual held owner advisory lock and observed database
  waiters before releasing both writers: identical request, competing same pin,
  changed payload under the same key, and swap versus real USD sale. Exactly one
  write commits, identical replay returns the same receipt, other attempts return409;
  uncommitted distinct keys are absent and balances/pins advance once.
- Owner and account1000th active swaps succeed;1001st refuses without any row/key
  change. Correction at capacity and original replay succeed. Ten pinned pages expose
  all1000identities. Owner10000versions accepts the last slot across accounts and
  rejects create/correct/void with spare local revision budget; old receipts and
  descending history remain available. Local/passive10000th ticks succeed, next
  mutation refuses; connected exact60USD basis and saved replay remain correct.
- Two linked accounts with500swaps each read successfully. A native synthetic extra
  row makes the component1001 while each account is below1000; real reading returns409
  after exactly one swap count query and before any swap materialization. No truncation
  or write occurs. This tests corrupt/oversized storage refusal, not a supported import.
- A swap consumes101original trade lots plus an incoming fee. Three50-item allocation
  pages expose102items in exact provenance order; every page retains full principal101,
  fee5 and realized44. Upstream buy correction changes principal102/result43, invalidates
  old journal-pinned continuation, preserves swap version1 and original command receipt.
- `caffeinate -is node /private/tmp/capital-swaps-pg.cjs` exited0, **6/6 main families**,
  `/private/tmp/capital-swaps-connected-attempt1.log`. Four retained families passed.
  New connected CSV family verifies null-basis preview, swap correction invalidating
  preview, exact60basis/20profit, confirm/rollback source/passive ticks, reward and
  transfer mutation refusal if they strand history, and original receipts/CSV bytes.
  Valid reward correction changes outgoing basis without replacing the declared incoming
  swap basis. A source two-row CSV batch funds an exchange; rollback correctly refuses.
- New concurrent read family uses two real PostgreSQL PIDs. It pauses each reader after
  executing its actual journal query, checks RR and READ ONLY in PostgreSQL, commits a
  swap correction on the writer connection, then resumes unchanged queries. History,
  chart and selected portfolio return the complete old DTO; the next request returns
  exact new values/pins. Chart old `[300,225,145,135,135]` becomes
  `[300,235,155,145,145]`; selected total155 becomes165. Each reader performs exactly
  one swap count and one nonempty connected swap materialization, including multiple
  swaps and two selected accounts. Reads add no rows and retain immutable swap replay.

Same backend release **sha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2**
and PostgreSQL16.10 in the guarded disposable project. All runtime attempts above
passed without financial oracle adjustments. Biome formatting was applied; final
scoped check exit0, `/private/tmp/capital-swaps-runtime-style.log`. Both CJS fixtures
and shared acceptance runner pass Node syntax; `git diff --check` passes. Shared
runner now includes the bounds fixture; `pnpm test:engineering` **183/183 in2suites**
passes6.34s, `/private/tmp/capital-swaps-runtime-engineering.log`. Strict OpenSpec
**29/29** passes, `/private/tmp/capital-swaps-runtime-specs.log`.

Final actual e2e-labeled container/network inventories are empty; preview durable
volume remains present. Protected Nginx/lock hashes are unchanged. No product rebuild,
production deployment, private data access, paid service, push or folder cleanup.
No new browser/full-suite/migration/audit/release pass is claimed; prior evidence is
retained with its actual dates. Root inspected fixture setup, transaction barriers
and exact assertions. Independent persistence/UI review remains blocked by the known
agent quota untilSep29/30 and is not claimed complete. Final verification/archive
remain unchecked. Frontend planning can proceed separately without archiving swaps.
