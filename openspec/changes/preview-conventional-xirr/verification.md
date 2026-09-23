# Conventional XIRR verification

Status: implemented, independently reviewed and verified with scoped checks.
Archive is the remaining administrative step.

Baseline dfa1f64: only owner `frontend/nginx.conf` modified; active changes empty
before this change; OpenSpec1.2.0. Existing guarded GHCR workflow and brownfield
deployment inventory inspected, retained. `pnpm --dir backend test --runInBand
--coverage=false period-profit.spec portfolio-flow.spec portfolio-flow-input.spec`
exit0:111 tests /3 suites,1.776s. No production/data/folder action.

Luna audited exact projection reuse and confirmed Decimal10.6.0 is only a jsdom
dev transitive dependency. Sol independently reviewed the conservative uniqueness
condition, ACT/365F timestamps, rate tolerance, interval endpoints, workload
limits and zero/unavailable cases; no design blocker. Official equation/library
sources and deviations are linked in design. Feasibility probe (not a product
benchmark):1000 exp calls at64/96 precision took298/663ms on host Node22.23.2.

## Risk-based check manifest

| Scenario | Check |
| --- | --- |
| XIRR-YEAR/FLOWS/ORACLES | Pure independently calculated one-year gain/zero/loss, irregular timing, same-instant exact sums, tiny values/time gaps, boundary precision and leap-year convention; real API ten-percent case. |
| XIRR-UNAVAILABLE | Pure each deterministic unavailable reason, both inclusive rate bounds,65-date refusal and1000-flow aggregation without truncation; UI out-of-range reason. |
| XIRR-SNAPSHOT/PRIVATE | Actual PostgreSQL two-connection read barrier, busy/release on error, foreign ownership, full read-only fingerprint, closed transaction before solving; real auth/MFA/CSRF/origin/no-store/400/409. |
| XIRR-UI/LATE | Two new HTTPS cases for explicit calculation, annualization/unavailable and a delayed real response superseded by reviewed profit; no backend/auth mocks. |
| Retained behavior |111 baseline cases, actual PostgreSQL profit fixture and2 retained profit HTTPS journeys. |
| Integration | Scoped E2E TS, backend/frontend build/lint, solver workload benchmark, frozen install/audit, strict OpenSpec and owner-file/cleanup checks. |

No full E2E/default broad regression run per owner instruction. No migration or
release change; complete upgrade matrix, hosted CI and production rollout are
not claimed. Existing CI gates/cases remain intact.

## Acceptance before implementation

Contract c61d5d6, pure/PG acceptance c3b2bb8 and transaction-entry observation
3efdc52 preceded product code. Luna wrote the two browser cases in an isolated
worktree (integrated56091f0); root reviewed their oracles and actual auth/provider
boundaries. Predecessor images were checked before running:

- Backend `sha256:24a9827a93bae8615bc84feb90f6351f3730e6d4ed77319f459e07b524cdacfb`.
- Frontend `sha256:1a5a83094e97866982fb28e84038286c5b74264565a1eca745759e6e61e2c6be`.

`/private/tmp/capital-xirr-predecessor-red.cjs` exited1. The retained profit API
returned200 with its expected DTO; XIRR then failed **expected200, received404**.
Log `/private/tmp/capital-xirr-predecessor-red.log`. The first UI attempt waited
too long for the missing button and also hit the quota-row expiry assertion;
that incidental failure is not UI RED evidence. Root added a direct button
visibility assertion and reran only XIRR-UI against the unchanged predecessor
images. `/private/tmp/capital-xirr-ui-red.cjs` exited1 at **missing button
Рассчитать XIRR**,10-second timeout; log `/private/tmp/capital-xirr-ui-red.log`.
This occurred before the UI implementation. No compilation/missing-module
failure is counted as behavioral RED.

## Implementation and independent review

Backend f820e25 adds a pinned direct Decimal10.6.0 dependency, exact preparation,
bounded asynchronous solver, shared snapshot helper and private endpoint. Sol
implemented UI in a separate worktree (de30f51, integrated1fd4d2c); root reviewed
the entire three-file diff, shared review/generation guard, unchanged profit DTO,
null-rate rendering and Russian limitation/annualization copy. Luna docs were
reviewed and integrateddae9260. No migration/provider/deployment change.

Sol independently reviewed the backend against design/spec after implementation:
no blocker. Reviewed sign-pattern uniqueness, exact aggregation, integer-ms
time basis, discount anchors, rounding/qualification, finite/bound checks,
workload cap/yields, owner snapshot and slot finally release. The actual PG
pass-through observer delegates to the unchanged real solver and asserts every
observed query runner is released before its entry. Nonblocking coverage limit:
429 is exercised while the DB read is paused, not by a second HTTP call during
CPU solving; the reviewed active flag encloses both phases.

## Actual scoped results

- Baseline111/3 passed; final `pnpm --dir backend test --runInBand --coverage=false
  xirr.spec period-profit.spec portfolio-flow.spec portfolio-flow-input.spec`
  passed **139 tests /4 suites**,2.693s (28 new,111 retained). The added64-date
  geometric-series oracle has an independently calculated rate0.1 and proves
  timer progress. Leap-year and1ms oracles used independent Python Decimal100.
- Backend build and lint exit0;77 existing warnings. Main frontend build/lint
  exit0;29 existing warnings and the retained bundle-size warning. Sol also ran
  the existing frontend Vitest suite successfully:95 tests /10 files. Main
  scoped E2E strict TypeScript command exit0:
  `pnpm --dir backend exec tsc --noEmit --strict --target es2022 --module commonjs
  --moduleResolution node --esModuleInterop --skipLibCheck
  ../tests/e2e/xirr-preview.spec.ts ../tests/e2e/period-profit.spec.ts`.
- Frozen install exit0 (544ms); production high/critical gate exit0. Full registry
  JSON audit exit1, **2 moderate,0 high/critical/low**,331 production dependencies.
  Existing Router findings remain; see docs/dependency-security.md. Offline add
  failed for absent cached metadata before the successful exact registry install.
- Actual PostgreSQL16.10, all17 existing migrations, fresh guarded synthetic
  databases: three XIRR families and four retained profit families pass. Complete
  >50-flow reads, upper boundary, foreign isolation, all-row read fingerprints,
  coverage/input failures, actual two-pool concurrent correction, original coherent
  revision/rate/profit,429, release and correction/void results are checked.
  `/private/tmp/capital-xirr-db-focused.cjs` final exit0; log
  `/private/tmp/capital-xirr-db-focused.log`. Initial run exit1 at an incorrect
  observer count (expected at least6 but fixture has exactly5 successful XIRR
  requests). Corrected to **exactly5** in a784593; no financial/security oracle
  changed. Initial log `/private/tmp/capital-xirr-db-initial-failed.log` retained.
- Reproducible `tests/e2e/xirr-benchmark.cjs` in the same pinned backend image,
  Node22.21.1: **64 dates,1970–9999**, BigInt timestamp interpolation,4,564ms,
  506 timer ticks, available annual rate `0.000105868499`. This demonstrates
  bounded fixture work and event-loop progress, not a universal latency SLA or
  an independent mathematical oracle. No wall-clock threshold was weakened.

Host Node22.23.2 was used because the formerly installed22.21.1 was removed
externally; repository/image pin22.21.1 and pnpm10.33.0 remain unchanged.
Full backend/full E2E, complete migration-upgrade matrix, hosted CI, image/DAST
release scans and production deployment were not run for this bounded slice.

## Real HTTPS GREEN and preservation

Source **dae9260856d5f877cf0c5c24fe7223327d5d0a8d** (backend f820e25,
UI1fd4d2c, tests a784593). `/private/tmp/capital-xirr-focused.cjs` built release-like
images, ran fresh migrations17 and synthetic seed, both backend replicas and
actual HTTPS proxy/client topology. Artifact/network isolation checks passed.
`pnpm exec playwright test tests/e2e/xirr-preview.spec.ts
tests/e2e/period-profit.spec.ts --workers=1` passed **4/4 in47.4s**, one worker,
zero retries, exit0. Two XIRR API/UI journeys plus two retained profit journeys
exercise password/MFA, CSRF/origin/no-store, correct returns, coverage and stale
delivery/error behavior against the actual backend and PostgreSQL. Only external
providers are stubbed; the delayed response uses actual `route.fetch()`.

- Backend `sha256:ab4db35ed693eb1dfc70541d9d3a17d86d45b57ef531fde7966ca0dd04092505`.
- Frontend `sha256:953f485238c2e57cef42f69f385633823c0936a3c880f5424e7e38374fbc5043`.
- Log `/private/tmp/capital-xirr-focused.log`; local artifacts
  `/private/tmp/capital-xirr-focused-artifacts`.

Final Docker project container and network queries returned empty. Owner
`frontend/nginx.conf` remains unstaged,mode0644,size1348,SHA256
`115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432`.
The intentionally changed lock hash is
`6a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d`.
Original projects, user data, deployment pipeline and worktrees remain intact;
no remote push, production action or directory removal. The whole target brief
remains substantially incomplete; this slice supplies conventional manual XIRR.
