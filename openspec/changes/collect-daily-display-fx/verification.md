# Daily display FX verification

Status: active; no implementation/GREEN/archive claim.

## Baseline and scope

At a09af5a, retained `pnpm --dir backend test --runInBand --coverage=false
valuation-history historical-valuation historical-accounting` passed95/4 in1.79s.
Raw log `/private/tmp/capital-next-baseline.log`. Active changes initially empty;
20 canonical specs. Owner Nginx edit and all existing data/worktrees preserved.
Node host22.23.2, image22.21.1, pnpm10.33.0, OpenSpec1.2.0, PG16.10.

Keep: exact USD accounting/manual prices/chart, Nest/TypeORM/PostgreSQL, Axios,
Jest/Vitest/Playwright, existing GHCR/Compose topology and protected deployment flag.
Simplify: new daily FX uses PostgreSQL storage/coordination instead of repeating
legacy in-memory patterns. Remove: nothing in this slice; legacy consumers retain
behavior until separately migrated. Schema18→19 is additive; no dependency change.
User deferred chart/max-period review until overall completion; no change here.

Sol researched official provider documentation and identified a viable no-key daily
FX source with cached end-use permission. Root rechecked official pages2026-09-24.
Scope is private indicative conversion, no reusable rate feed/redistribution. No
live source request, account creation, credential access or paid service activation.

## Selected checks

- Pure exact parser/product/time/cooldown edge cases plus retained valuation suites.
- Actual PG: fresh19 and populated18 preservation/replay, exact complete batches,
  duplicate/correction rejection, RR read/fingerprints, separate-connection lease
  race/fencing/crash budget and failed transaction with last-good preservation.
- Actual outbound adapter against controlled external fixture: valid, malformed,
  rate-limited, redirect, timeout and bounded data; no mocked backend/authentication.
- Two new HTTPS API/UI cases plus retained VCH-UI, real password/MFA/backend/PG,
  strict negative inputs/CSRF, exact values, zero provider-on-read and late results.
- Relevant frontend tests, builds/lints/scoped TS, production dependency gate,
  migration current-version fixture updates and strict OpenSpec validation.

Full E2E/full backend, full older-schema matrix, hostedCI, release scans and production
are not selected. Existing CI tests/gates remain. New schema migration requires
real fresh19 and populated18 upgrade evidence even though full matrix is unrun.

## RED / implementation / GREEN

Independent contract review (Sol) corrected a fixed-window budget proposal to the
last three actual reservation timestamps, ensuring the promised rolling24h cap.
It also required connection-time direct DNS address validation and an explicitly
opted-in trusted egress-proxy boundary; root incorporated both. Replay compares
provider fields while preserving the original fetchedAt. No remaining contract
blocker. Strict21 items (20 canonical + active change) passed. Production dependency
audit exit0, two existing moderate findings/no high or critical; raw log
`/private/tmp/capital-fx-audit.log`. No lock change.

Pending. Missing future modules/tables are not behavioral RED; use predecessor
images and missing protected route/UI assertions before product implementation.
