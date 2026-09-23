# Manual USD prices verification

Status: implemented, independently reviewed, PostgreSQL and three targeted HTTPS
journeys pass. Strengthened UI refresh-failure assertion also passes; archive pending.

Baseline92a3039: only owner frontend/nginx.conf edit. Active changes empty and17
canonical specs before this slice. `pnpm --dir backend test --runInBand
--coverage=false input.spec accounting.service.spec` passed433 tests/9 suites,
2.745s; the regex also selected existing accounting/auth input suites.

Luna audited legacy memory/Redis price paths and manual instrument identity.
Sol independently reviewed initial contract: added immutable void support so an
erroneous timestamp can be excluded without pretending zero means missing;
froze READ COMMITTED lock-before-replay/CAS, UUID identity, full instrument paging,
exact retry envelope and explicit refresh handling. No provider entitlement or
storage permission is assumed. Existing gated GHCR/Compose workflow retained.

## Risk-based check manifest

| Scenarios | Planned verification |
| --- | --- |
| PRICE-EXACT/BOUND | Pure strict canonical input/query tests plus real PG exact numeric/FK/check/cap checks. |
| PRICE-REPAIR/RACE | Real PG set/correct/void/restore, immutable receipts, same UUID replay and separate-pool contending CAS. |
| PRICE-PAGES/SNAPSHOT | PG latest-per-instant projection before paging, pinned conflict and actual concurrent RR read barrier. |
| PRICE-PRIVATE | Real HTTPS password/MFA, CSRF/origin/no-store, foreign404, malformed400, provider/all-row fingerprints. |
| PRICE-UI/RECOVERY | Two HTTPS journeys: private API contract; UI persist/correct/history/void/reload, lost real response retry and late selection read. |
| PRICE-MIGRATION | Fresh18, populated17 upgrade preserving all old rows, rerun and downgrade refusal. |
| Retained integration | Scoped existing input/accounting units, one critical manual-account browser journey, build/lint/types and strict specs. |

No full E2E/default broad suite per owner instruction. No live provider, hosted CI,
release scans or production deployment is claimed. Existing migration acceptance
was run because its shared current-schema expectations changed.

## RED before product changes

Contract cdde4d8; root pure/PG acceptance8b6dd1c, Luna HTTPS744bc2a (integrated
ad96a36). Root independently reviewed browser draft: fixed premature empty-state
expectations, one-shot late delivery, history-scoped locators and void review;
these fixes did not weaken financial assertions. Pure invalid inputs explicitly
require BadRequestException, not arbitrary thrown exceptions.

Actual `/private/tmp/capital-prices-predecessor-red.cjs` exited1 with two expected
failures before root/backend or Sol/UI implementation. The new endpoint did not
exist: pending-MFA request expected401 but received404. The new Russian heading
`Ручные цены инструментов` was absent (direct10-second visibility assertion).
These are behavioral failures, not missing-module or build failures. Log
`/private/tmp/capital-prices-predecessor-red.log`; exact predecessor image IDs
were checked before starting the real HTTPS/auth/MFA/PostgreSQL stack:

- Backend `sha256:ab4db35ed693eb1dfc70541d9d3a17d86d45b57ef531fde7966ca0dd04092505`.
- Frontend `sha256:953f485238c2e57cef42f69f385633823c0936a3c880f5424e7e38374fbc5043`.

## Implementation and independent review

Root backend/schema978247d; Sol UI775f288 integratedac9f408. Root reviewed all
five UI files and fixed the DTO's instrument type to match its actual fields,
added explicit history lookup for voided points and exact readable price spans
(b01bced), with acceptance assertions preserving100/110/void history. Future
historical valuations are not implemented by this slice.

Sol independently reviewed root mutation locking/CAS/replay, owner scoping,
effective projection/paging, RR history, numeric/date/ownership constraints and
controller identity: no blocker. Luna independently reviewed PG/input acceptance;
root added persisted revision/point checks after both concurrent races, supplementing
response checks. Full immutable command recovery stays in owner-keyed module
memory only; no local/session storage or automatic write retry.

## Actual unit, build and database results

- `pnpm --dir backend test --runInBand --coverage=false manual-price-input.spec
  input.spec accounting.service.spec` passed488 tests/10 suites,2.743s:
  55 new boundary cases plus433 retained cases. No full backend coverage claim.
- Backend build/lint exit0;77 existing lint warnings. Initial scoped Biome check
  required splitting two variable declarations, fixed before the passing checks.
  Main frontend build/lint exit0;29 existing warnings and retained bundle warning.
  Sol also ran95 existing Vitest tests/10 files successfully in the UI worktree.
- Scoped E2E strict TS exit0 via `pnpm --dir backend exec tsc --noEmit --strict
  --target es2022 --module commonjs --moduleResolution node --esModuleInterop
  --skipLibCheck ../tests/e2e/manual-usd-prices.spec.ts`.
- `pnpm audit:production` exit0, log `/private/tmp/capital-prices-audit.log`;
  the same2 moderate findings remain visible. No dependency/lock changes or new
  full JSON report. Host Node22.23.2/pnpm10.33.0; pinned image Node22.21.1 unchanged.
- `/private/tmp/capital-prices-db-focused.cjs` final exit0, actual PostgreSQL16.10.
  Five new PG families pass: fresh18/populated17 upgrade/rerun/downgrade refusal;
  exact tiny/max/zero, correction/void/restore/history/replay/foreign isolation;
  two-pool distinct-command CAS and same-command replay (persisted state checked);
  actual paused RR snapshot across committed correction;10000-version cap/replay,
  actual numeric/date/kind/composite-FK constraints. Prior accounting rows and
  original opening receipt remain byte-for-byte unchanged.
- Same run executed retained `migrations.cjs`: missing-config and lock refusals,
  fresh18/replay, populated/empty unsafe legacy refusal, previous8/9/10 upgrades,
  populated11/12/13/14/15/16-to18 with schema/row/session/MFA/recovery preservation.
  The new fixture separately checks populated17-to18. Shared current-version
  assertions were extended to exactly18 and the new migration name/table; no
  historical fixture assertion was changed from17 to18.
- Initial PG run exited1 after passing migration checks: synchronous400 validation
  escaped the test's promise-only assertion wrapper.442b861 made the wrapper
  catch both synchronous exceptions and promise rejections; exact400/404/409
  expectations and product behavior stayed unchanged. Initial log
  `/private/tmp/capital-prices-db-initial-failed.log`; final
  `/private/tmp/capital-prices-db-focused.log`.

## Real HTTPS results

Product source **b01bced1594fc1096b0cd14f3b425494a828cc60**. Rebuilt isolated
images, migration18, actual password/MFA and PostgreSQL, both backend replicas,
real TLS proxy and artifact/network isolation checks. Command:
`pnpm exec playwright test tests/e2e/manual-usd-prices.spec.ts
tests/e2e/manual-opening.spec.ts --grep 'PRICE-|OPEN-001-A / OPEN-002-A' --workers=1`.
**3/3 passed in44.7s**, one worker/zero retries, harness exit0:
new private price API, new editor/retry/history/void/late-read journey, and retained
OPEN-001-A/OPEN-002-A exact opening/restart/history. Log
`/private/tmp/capital-prices-focused.log`; artifacts
`/private/tmp/capital-prices-focused-artifacts`.

- Backend `sha256:16266828034a018b39ec611733c062415da7e5d2001ee19a054385c620fa3dfd`.
- Frontend `sha256:45a1f6056008cddc1162ebb52681475af63863922a673bcff947b79fac08c9db`.

No own backend/auth responses are fabricated: lost/delayed delivery uses the real
`route.fetch()` result. External provider counters remain unchanged by this slice.
Additional test-only b00a1cc asserts accepted save plus failed real refresh remains
accepted and new writes stay disabled until explicit refresh; only PRICE-UI is
rerun for this new assertion, not already-passing API/account/PG checks.

That final targeted rerun at **b00a1ccc0432fe7df22a4cf46f95d682e3234f02** passed
**1/1 in13.5s**, one worker/zero retries, exit0; both image IDs above were identical.
Command: `pnpm exec playwright test tests/e2e/manual-usd-prices.spec.ts --grep
PRICE-UI --workers=1`. Log `/private/tmp/capital-prices-ui-recovery.log`, artifacts
`/private/tmp/capital-prices-ui-recovery-artifacts`. This covers original request
retry after actual commit with lost response, accepted commit with failed follow-up
GET and explicit refresh, and late old-instrument GET ignored after selection.

## Preservation and limits

Owner Nginx remains unstaged,mode0644,size1348,SHA256
`115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432`.
Package/lock graph unchanged; lock SHA256
`6a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d`.
All original project folders/worktrees and owner data remain intact. No remote
push or production action. Whole brief remains incomplete: these are manual
isolated price points, not automatic portfolio values or provider price history.
Final queries for Docker containers and networks labeled project
`capital-tracker-e2e` returned empty. Strict pre-archive validation passed18/18
(17 canonical specs plus the active change); all artifacts done.
