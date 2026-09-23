# Verification: historical accounting snapshot

Status: historical backend and Russian view implemented after genuine predecessor
RED. Actual PostgreSQL acceptance and source checks passed; independent backend
review finding reproduced and fixed with RED/GREEN. All seven focused HTTPS cases passed; the complete
release gate remains pending. The bounded change is not ready for archival.

## Artifact review — 2026-09-23

An independent explicitly selected gpt-6-luna context read the proposal/design/spec
against the actual FIFO, store and page-parser contracts. No arithmetic or preserved-
contract blocker was found. Root resolved its three concrete ambiguities: the exact
pre-Jan3 millisecond, the corrected120 precondition for void restoration, and explicit
terminal/empty-page nextOffset rules. This is a read-only artifact review, not runtime
verification. Installed OpenSpec1.2.0 strict validation passed14 items (exit0), including
the still-active carry-in prerequisite; all four new artifacts are apply-ready.

## Acceptance preparation — not executed

Root prepared `historical-accounting.spec.ts` and
`historical-accounting-input.spec.ts` under backend/src/accounting, against proposed
`projectHistoricalAccounting(heads, baseline, at)` and `parseHistoricalQuery(raw)`
interfaces. They cover complete prefixes, effective-time correction, terminal void,
fee atoms, original partial-lot coordinates, known zero, UUID aggregation,100+1000
maximum-precision inventory and strict query normalization. Scoped Biome passed;
an independent Python Decimal calculation confirmed the1100-lot maximum literal.
At preparation time production modules were absent: no Jest success or module-error RED was claimed.
Actual missing-feature RED must come from the HTTPS/browser tests on verified images.

An independent gpt-6-luna author prepared two actual API/UI cases in
`tests/e2e/historical-accounting.spec.ts` (0a6efa2). Root review strengthened retained
rows to include all trade tables and replaced the UI's incorrect unchanged-CSRF
assumption with the exact existing navigation-admission delta. The author applied
both; corrected120/320/230 and carry-in250/100 expectations remain unchanged.
Root also prepared `historical-accounting-security.spec.ts` for actual anonymous/
pending denial, foreign ownership, strict raw query errors, unavailable coverage and
exact empty-journal shape, with no business/provider changes. All E2E TypeScript
passed strict checking, exit0 (`/private/tmp/capital-historical-draft-tsc.log`), using
symlinks to existing main-checkout dependencies; no install or product change.
Scoped Biome passed. At that preparation stage browser cases were unrun while the
carry-in prerequisite was awaiting its alert correction and complete release rerun.

The independent author also prepared `historical-accounting-db.cjs` (82a8baa): actual
production service + fresh synthetic PostgreSQL, guarded absent fixture database,
full-row fingerprints across reads/refusals, UUID pages/stale revision and separate
reader/writer processes with a real query barrier. Root review corrected the second
instrument's independent expected quantity2 (original draft incorrectly said1),
narrowed claimed coverage to HIST-002/003 and removed unused boilerplate. Syntax/diff
checks passed at that stage; the later PostgreSQL results are recorded below. The probe expects
`HistoricalAccountingService(source).getSnapshot(ownerId, accountId, rawQuery)`.
Missing future service is a prerequisite error before creating its fixture database.
At that stage real100+1000 bounds and expanded late-response UI checks were pending;
they were subsequently implemented and reviewed before execution.

Independent `historical-accounting-journey.spec.ts` preparation153d979 adds one actual
delayed-response scenario with a preserved unsaved correction. Root verified existing
form selectors and strengthened its no-write oracle to forbid every accounting POST,
not just a POST to the new read route. It delays actual `route.fetch()` output without
inventing backend data. Scoped Biome and strict E2E TypeScript passed, exit0
(`/private/tmp/capital-historical-journey-tsc.log`); temporary dependency links removed.
At that stage the case was unrun and account-switch, pinned409 and PostgreSQL100+1000
coverage were outstanding. They were subsequently added; actual results follow below.

| Scenarios | Planned executable evidence |
| --- | --- |
| HIST-001-A, HIST-002-A | `tests/e2e/historical-accounting.spec.ts`: actual owner/password/MFA, HTTPS API/UI, PostgreSQL; exact chronological100/300/100 costs and250/230 realized, inclusive baseline boundary |
| HIST-001-B, HIST-002, HIST-003 | `backend/src/accounting/historical-accounting*.spec.ts`: independent pure/input vectors for corrected execution times, voids, fees, atoms, zero cost, shared-FIFO original coordinates and page bounds |
| HIST-003, HIST-004-B | `tests/e2e/historical-accounting-db.cjs`: production service through real PostgreSQL, RR process barrier, revision conflict, complete accounting fingerprints and supported maxima |
| HIST-004 | `tests/e2e/historical-accounting.spec.ts`: late actual response delivery, changed account/instant, real409, unchanged parent correction, literal labels, private admission/error behavior and zero provider requests |

Record actual predecessor source/images and intended missing-route/UI RED before
product changes. Unit/service doubles cannot substitute for database/browser checks.
Retain original receipts/import bytes and documented authentication/admission deltas.
The final release gate must run the complete existing suite, not only new scenarios.
Hosted CI, other browser engines, backup/restore and production remain unrun unless
separately evidenced. There are no new migration or provider checks in this slice.

## Exact predecessor behavior RED — 2026-09-23

At11b18f1 (only new specification/acceptance code), command
`caffeinate -is node /private/tmp/capital-historical-predecessor-red.cjs` checked the
exact verified backend36856553e640b6906894d3e70dc8122548b31e7b84a699777344699e008da315
and frontendf81445af15fe1c9f48c39ee13118bbdd0e00c8060d91676a72fcbed8f1868c0a
image IDs, used --no-build, actual migrations/seed, PostgreSQL and HTTPS password/MFA.
Terminal exit1: two intended failures. HIST-001-A API expected200 received404 at
historical-accounting.spec.ts:118; HIST-004-A expected the Russian history heading
visible at:243, but it did not exist. Fixture, actual authentication, retained-row,
admission/provider assertions completed; finally cleaned up the synthetic project.
Log `/private/tmp/capital-historical-predecessor-red.log`; synthetic failure artifacts
`/private/tmp/capital-historical-red-artifacts`. This is feature RED, not an import or
compile failure. Product implementation started only after the terminal result.

Initial backend projection/input implementation passed37/37 tests in2suites,2.667s,
exit0 (`pnpm --dir backend test --runInBand historical-accounting`); backend build
exit0 (`/private/tmp/capital-historical-backend-build.log`). Scoped Biome passed.
A real PostgreSQL maximum fixture now covers100 original lots plus1000 current buys
at maximum input precision; expected values independently checked with Python Decimal
precision100. It was wired into the existing full acceptance runner; its subsequent passing result
is recorded under Backend and independent review below.

## Backend and independent review — 2026-09-23

At85c7581, complete backend tests passed939/939 in30suites,10.093s,exit0; lint
exit0 with77 existing warnings. Logs `capital-historical-backend-tests.log` and
`capital-historical-backend-lint.log` under/private/tmp. Actual production-image
PostgreSQL probe (`caffeinate -is node /private/tmp/capital-historical-db-focused.cjs`)
passed all coverage/ownership/known-zero, UUID paging/stale revision, two-process
RR/read-only barrier and100+1000 maximum-precision families, terminal exit0.
Image sha256:bb9e33d8218ba26225abb3f33834c83be707f4bf2a60f2468cb0f22bb8942c21;
log `/private/tmp/capital-historical-db-focused.log`. Independent post-run Docker
container/network inventories were empty. These are PostgreSQL results, not UI GREEN.

Independent gpt-6-sol review (frontend author, separate from root backend author)
found one saved-data error classification gap. The actual fresh PostgreSQL fixture
set a baseline acquisition after coverage, with SQL constraints enabled; expected409
received a non-HTTP error against unchanged bb9e33 image, exit1. First failure log
withheld exception detail; a repeated diagnostic check safely printed only the
expected/actual status, `/private/tmp/capital-historical-invalid-confirmed-red.log`.
No import, setup or SQL constraint failure was counted as this behavior RED.

Explicit saved-baseline invariant failures now use the shared FifoHistoryError.
Historical head/baseline reads occur inside a narrow persisted-validation catch,
which maps FifoHistoryError/BadRequestException to the existing private409. Raw
caller input remains parsed outside; SQL and programming exceptions remain500.
Unchanged old callers retain their original private500 saved-baseline path. The
same reviewer inspected this exact diff and closed the finding. Actual rebuilt-image
PostgreSQL probe then passed all five families including that regression, exit0,
`/private/tmp/capital-historical-invalid-green.log`. No schema/dependency change.

Frontend production files from independent worktree b104603/14e6fbc integrated as
f5e88fd/42b6805. Root reviewed request invalidation, exact/pinned pages, Russian
labels, literal rendering and preserved parent state. Newly authored API-mocked
component tests were removed to follow the external-provider-only mocking boundary;
all predecessor frontend tests are retained. Real HTTPS journeys remain mandatory.
Do not infer a final frontend count from the author's earlier intermediate98-test
log; integrated source verification below records its actual result.

## Integrated source checks — 2026-09-23

After the saved-history correction, backend lint/build/tests all exited0;939/939
in30suites,10.45s,77 existing lint warnings. Frontend lint/build/tests all exited0;
95/95 in10files,2.82s,29 existing lint warnings and existing bundle-size warning.
Logs `/private/tmp/capital-historical-backend-final-{lint,build,tests}.log` and
`/private/tmp/capital-historical-frontend-{lint,build,tests}.log`. Existing frontend
tests are unchanged; no own-backend test double was added to the final change.

Frozen install exited0 with unchanged lockfile; the first restricted attempt refused
a module-directory replacement because its normal store was inaccessible, then the
exact same frozen command succeeded with normal store access and no package update.
Live `pnpm audit:production` exited0: zero high/critical, two existing moderate
Router findings unchanged. Logs `capital-historical-frozen-install.log` and
`capital-historical-audit.log` under/private/tmp. No advisory suppression or upgrade.

## Browser acceptance integration and review

Independent gpt-6-luna authored two additional real browser cases in6fa53f6,
integrated as11ac0dc: account-switch late-response invalidation and51-position
carry-in pages with an actual competing trade, pinned409, successful refreshed
continuation and observed parent-revision invalidation with the correction draft
retained. Root review corrected setup chronology, baseline-plus-buy quantity2,
preview allowlist and nested journal shape before runtime; no incorrect oracle
was accepted. Existing assertions were retained. Root strengthened the initial UI
case with a literal hostile instrument label and explicit no-execution assertions.
All seven cases were integrated before their execution below. Strict E2E TypeScript passed,
exit0 (`/private/tmp/capital-historical-e2e-tsc.log`). The source guide records
coverage, reconstruction/cumulative-total limits, revision conflicts and no writes.

## Focused HTTPS GREEN — 2026-09-23

Atc8873bb, `caffeinate -is node /private/tmp/capital-historical-focused.cjs` built
the production images and passed7/7 Chromium cases in1.4m, one worker/zero retries,
terminal exit0. Log `/private/tmp/capital-historical-focused.log`; synthetic artifacts
`/private/tmp/capital-historical-focused-artifacts`. Tests used real password/MFA,
HTTPS reverse proxy, protected backend, migration16 and PostgreSQL. Only external
providers were stubbed. Route delays forwarded actual fetched backend responses.

Exact images: backend sha256:1f6ce77cba5ad9444ccb8d3a6ba769fc722560bf9145401651f418054a33388f;
frontend sha256:acf24293ebd64f3cbc9425c7e86504402c55109a849a9ac0f46630e7b1d2cc95.
Independent post-terminal Docker container/network inventories were empty. Owner
Nginx SHA256115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432
and lock SHA256aa2588325aacdc54e8437d3500c7d2df580cc20cd061d1e3727f30f0dcc1e4f8
were unchanged. Exact financial/receipt fingerprints, admission deltas and zero
provider/write assertions passed, including the real pinned409, successful final
page, account switch, edited instant, observed revision and literal hostile label.

Independent documentation/max-fixture review confirmed expected decimal literals,
counts and bounded scope. It flagged stale present-tense preparation notes; those
were reconciled into dated past-tense history without changing actual results.
Canonical+active strict OpenSpec passed14/14, exit0
(`/private/tmp/capital-historical-spec-validation.log`). Full release gate pending.
