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
Independent fixture review identified that the existing two-command buy race shares
a chronology key: its loser could fail chronology validation rather than stale CAS.
It also does not prove the required competing-sale/no-overspend case. A separate
distinct-order sell race is being added; task3.5 remains incomplete until it passes.
Full backend lint/build,737 tests/24 suites,183 engineering tests/2 suites and strict
OpenSpec11-item validation passed: /private/tmp/capital-usd-backend-baseline.log exit0.
The PG trade fixture preserves populated users/owner-auth and all existing financial
rows; it does not seed live session/MFA/admission rows. Populated migration preservation
already tests those states; trade-write preservation awaits the real authenticated
HTTPS cases. Expanded HTTPS acceptance, frontend gates/review and archive remain pending.
