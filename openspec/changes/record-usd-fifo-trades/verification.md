# Verification: record-usd-fifo-trades

Status: genuine acceptance RED observed; backend and PostgreSQL checks pass.
Frontend and complete release-image acceptance remain pending; not archive-ready.

Predecessor manual openings completed85/85 real Chromium cases, all PG/CLI/migration
prerequisites and independent review, then actual archive e2080aa on2026-09-23.
Canonical manual and migration scenarios were compared against both modified deltas;
none removed. Strict OpenSpec validates all11 current items. Separate contexts
reviewed the arithmetic, SQL/transaction/read contract and complete UI state plan.

Independent QA authored maintained real HTTP/UI tests99b5789, integrated0057abd,
before any trade behavior or schema change. Root ran Node22.21.1:
`caffeinate -is node /private/tmp/capital-usd-trades-red.cjs`.
Exit1 in /private/tmp/capital-usd-trades-red.log contains exactly two intended failures:
- TRADE-001-A: actual password/MFA and auth/me200, existing account create/read/history
  succeeded; explicit journal initialization expected201, actual404.
- TRADE-006-A: actual protected account heading was visible, exact Russian journal
  heading was missing.
No future helper/table was a prerequisite. Finally checks preserved every prior
business/factor/admission row (only authorized session activity excluded) and provider
requests. Only external providers are stubbed. Backend/authentication/PG are real.
Actual image migration13/seed/replicas/HTTPS/artifact isolation prerequisites passed.

Exact predecessor images (no rebuild before RED):
- backend sha256:9efd443953ddd723844aca23da46a9de6b016ffbc16b443ed65a933b3f35ce47
- frontend sha256:cca53f6ade800efbb256f5164f37ebf4b4085190bde35253b44fe394ee0bf084

The wrapper completed cleanup; independent Docker reads found no owned Compose
containers/networks. Owner Nginx hash remained
115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432.
No owner data, original folder or production deployment was touched.

Preimplementation unit tests27c7ee5 were independently reviewed; source syntax,
scoped Biome and independent integer arithmetic literals passed. Unavailable imports
were never executed or claimed RED. Pure helpers92e4c12 and backend81587f2 were then
integrated. The mixed raw-attestation table needed an explicit `it.each<unknown>`
annotation; no assertion or expected value changed.

Focused verification on2026-09-23 (Node22.21.1, all terminal exit0):
- `pnpm --dir backend exec jest src/accounting/fifo.spec.ts
  src/accounting/trade-input.spec.ts src/accounting/input.spec.ts
  src/accounting/accounting.service.spec.ts --runInBand --coverage=false`:
  196 tests/4 suites, including70 new independent arithmetic/parser tests.
  Log: /private/tmp/capital-usd-source-first.log.
- `caffeinate -is node /private/tmp/capital-usd-trades-pg.cjs migrations.cjs`:
  actual fresh14/replay, all retained unsafe-history refusals and populated upgrades
  from8/9/10/11/12/13 passed. Populated13 preserves existing manual and authentication
  rows/schema and adds empty journal tables. Log: /private/tmp/capital-usd-migrations-first.log.
  The first log used TRADE-005-A for the13-to14 scenario; source label is now corrected
  to TRADE-MIG-001, with identical assertions.
- `caffeinate -is node /private/tmp/capital-usd-trades-pg.cjs
  usd-trades-db.cjs manual-opening-db.cjs`: independently authored fixturesdfbef7a
  exercise compiled production services and real PostgreSQL. All exact FIFO vectors,
  provenance, raw/owner failures, correction/void/replay, historical-prefix validation,
  finite/composite/deferred constraints,1000-active/10000-version limits, distinct-process
  lock/CAS/opening-init races, deferred-COMMIT rollback and original-key retry passed.
  Five current projections demonstrated actual read-only repeatable-read SQL with an
  observational process barrier while another actual service committed a correction;
  no query or result was mocked. All retained manual-opening PG cases also passed.
  Prior financial/authentication rows were preserved. Log: /private/tmp/capital-usd-pg-first.log.
  Built backend image: sha256:17283e22fdc410782a31ebdd86e627e8c07cb576fd1f0b82ffb9bc87e39fc2c3.

The isolated wrappers completed owned Compose cleanup. Owner Nginx and lockfile
hashes remain unchanged. Independent backend/schema review found no blocker in
owner predicates, lock ordering, replay-before-CAS, complete history or read isolation.
Root has wired TradeController/TradeService into AccountingModule; actual HTTPS
verification of that integration still awaits the complete frontend/image run.
Independent fixture review identified that the first two-command buy race shares
a chronology key: its loser could fail chronology validation rather than stale CAS.
It also does not prove the required competing-sale/no-overspend case. A separate
distinct-order sell race was added in c25b5a9 and independently reviewed. The repeat
`caffeinate -is node /private/tmp/capital-usd-trades-pg.cjs usd-trades-db.cjs`
passed all cases, terminal exit0: /private/tmp/capital-usd-pg-race-review.log.
Two separately valid buys with distinct chronology isolate CAS. Two0.75-unit sales
against1 unit commit only one sale, leaving exactly0.25/$25. Both stale and freshly
revised oversold retries remain atomic; after a legitimate backdated0.5/$50 purchase,
the same losing request key is reusable and exact totals remain150 cost/180 net/30 result.
Full backend lint/build,737 tests/24 suites,183 engineering tests/2 suites and strict
OpenSpec11-item validation passed: /private/tmp/capital-usd-backend-baseline.log exit0.
The PG trade fixture preserves populated users/owner-auth and all existing financial
rows; it does not seed live session/MFA/admission rows. Populated migration preservation
already tests those states; trade-write preservation awaits the real authenticated
HTTPS cases. Expanded HTTPS acceptance, frontend gates/review and archive remain pending.

Frontend214bec4+6be9da9 integrated after root review. Actual integrated lint/build and
81 retained tests/10 files passed, exit0: /private/tmp/capital-usd-frontend-integrated.log.
Existing77 backend/29 frontend warnings and the existing bundle-size warning remain.
Frozen install and the live required production audit passed, terminal exit0:
/private/tmp/capital-usd-frozen-live.log and /private/tmp/capital-usd-audit-live.log.
The audit still reports2 moderate findings. Initial sandbox attempts failed due to
pnpm cache context/no-TTY and registry DNS restrictions; those were not counted as
successful checks. Reviewed escalations completed without changing the lockfile.

Independent frontend review found two unresolved blockers: manual refresh can bind
a selected old correction/void draft to an unseen newer revision, and a stale-read
review can discard an unresolved command after a lost successful response. Related
ambiguous initialization must keep the opening editor blocked until a current read.
TRADE-006-C/D now make these observable requirements explicit. Independent real HTTPS
regressionsf8d2ea5 were integrated before fixing either defect. Actual
`caffeinate -is node /private/tmp/capital-usd-trades-focused.cjs regression` exited1:
/private/tmp/capital-usd-ui-review-red.log. Exactly two intended assertions failed:
- After a real external correction and manual refresh, Save was enabled rather than
  disabled pending review of the new target.
- After a real correction201/PG commit followed by aborted response delivery, actual
  pinned-read409 and explicit review, resubmission returned201 instead of200, creating
  an extra correction rather than resolving the original command.
The network fault forwarded the unchanged real request with route.fetch, verified
its actual201 and PostgreSQL commit, then aborted delivery; no backend response or
authentication was fabricated. Artifact/MFA/HTTPS prerequisites passed. Synthetic
cleanup completed; retained screenshots/traces are in
/private/tmp/capital-usd-ui-review-red-artifacts.
Pre-fix backend17283e22fdc410782a31ebdd86e627e8c07cb576fd1f0b82ffb9bc87e39fc2c3,
frontend e39d4b2f442bf087612ddae5287361f7c40075e04e473e113eb18fd8b2c5a182.
The fixes and complete release acceptance remain pending. Do not archive yet.

The other12 new cases ran separately on the same pre-fix images:
`caffeinate -is node /private/tmp/capital-usd-trades-focused.cjs '^(?!.*regression)'`.
Exit1,9 passed/3 failed in8.3 minutes: /private/tmp/capital-usd-focused-first.log.
All three failures waited for nonexistent instrument pagination before the journal
form had rendered; their later snapshots contain the desired instrument. No financial
or security assertion failed in those cases because their trade-entry prerequisite
had not completed. Fixture98f2925 replaces network-idle/count assumptions with actual
form/picker readiness and increasing option counts after bounded pagination; no
financial expectations, quotas or application behavior changed. Artifacts retained at
/private/tmp/capital-usd-first-focused-artifacts. The9 passed cases include precision,
fees/residual/loss, authorization/raw types, real two-replica races, immutable receipts,
historical rejection and actual deferred HTTP COMMIT500 privacy/rollback/retry.

Fixd5c4628 is integrated and source-checked. Independent review identified one further
path: a pre-controller403/429 on a later replay must not clear prior ambiguity about
an earlier committed request. Independent regressiona609197 now exercises a real
committed correction/aborted delivery and real missing-CSRF403; its GREEN is pending.
The current regression image is frontend
273759401e554923f8de4312051c5cd9c5ac4e83fbcf58545030616d9324f4ee.
Label-only commit5eb748e aligns fixture/test scenario references with the final spec;
assertions and runtime behavior are unchanged.

The first fix run exposed two remaining test locator errors: wrapped SELECT label text
includes option text in the installed Playwright label engine, whereas its actual ARIA
combobox name is correct. Narrow fixtured8cbc62 uses exact named combobox roles for
the two selects, preserving all seven disabled-control checks and exact selected UUID
assertions. /private/tmp/capital-usd-ui-first-fix-regressions.log exited1 with one pass
and two missing-selector failures; those failures were not treated as behavior RED.

With corrected selectors, /private/tmp/capital-usd-ui-denied-retry-red.log exited1:
two original UI regression cases passed, and the new denied-retry case failed exactly
as intended: after an actual committed correction/lost response and real CSRF403,
the instrument control was enabled instead of remaining disabled. The run took50.6s.
Artifacts: /private/tmp/capital-usd-denied-retry-red-artifacts. Only then was fixbfd90df
implemented: previous ambiguity survives all failures except successful receipt or an
authoritative409 from the exact original POST. Independent review traced the current
guards, filter, proxy and replay-before-conflict service ordering; no pre-controller409
path exists. Journal GET409 never resolves a pending write. Current CSRF preflight
can propagate an error but has no409 outcome. No new endpoint/error framework was added.
All frontend findings are resolved in source; runtime GREEN of the final fix is pending.

An additional initialization-ambiguity test, ecc954d, was authored after the first UI
fix. It was checked retrospectively against the retained pre-fix frontend imagee39d4b2:
`caffeinate -is node /private/tmp/capital-usd-init-old-image.cjs` exited1 at the intended
assertion, opening Save expected disabled/actual enabled after actual initialization201
and aborted response delivery. This is retrospective pre-fix evidence, not a claim
that this extra test preceded implementation. Log: /private/tmp/capital-usd-init-prefixed-evidence.log;
artifacts: /private/tmp/capital-usd-init-prefixed-artifacts. The wrapper cleaned the
synthetic stack and restored the current2737594 image tag in finally.

Final integrated source gates exited0:
`pnpm verify:baseline && pnpm test:engineering && pnpm exec playwright test --list`.
/private/tmp/capital-usd-final-source-gates.log records strict11-item OpenSpec validation,
backend/frontend lint/build,737 backend tests/24 suites,81 frontend tests/10 files,
183 engineering tests/2 suites and101 real-E2E cases discovered. Existing77/29 lint
warnings and the existing bundle-size warning remain. Discovery is not execution.
Final frontend image before focused acceptance:
sha256:ebf4d8ce70cd660fc854459c6c84519fec7d54ab087a8019fc8f37f57a6234ad.
