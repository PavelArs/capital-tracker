# Account valuation history verification

Status: active, no GREEN/archive claim yet.

## Scope and check manifest

Keep existing accounting/scale60 valuation, price storage/index, Chart.js and
GHCR/Compose containment. Simplify shared single-transaction ledger/price loading.
Remove no code/data/dependency. No migration or provider change; schema remains18,
PostgreSQL16.10, image Node22.21.1, pnpm10.33.0, OpenSpec1.2.0.
Host uses existing Node22.23.2 wrapper because pinned host version was removed
externally. No global tooling changes or dependency installation.

Root owns backend/PG/shared runner/Docker. Luna owns two E2E cases in chart-acceptance
worktree, Sol reviews the contract/tests and owns chart-ui after actual RED. Root
reviews UI before integration. Worktrees preserve unrelated edits/data.

| Scenario/risk | Selected checks |
|---|---|
| VCH-RANGE/TIMELINE | New backend pure range/sampling/series tests plus retained historical and point-valuation tests |
| VCH-SNAPSHOT/PRIVATE | Fresh guarded PG schema18, actual services, fingerprint preservation, paused separate-connection RR and31-point/100carry-in/1000trade maxima with one read per table |
| Shared reader refactor | Retained historical-valuation-db.cjs; existing historical/point unit and VAL-UI HTTPS characterization |
| VCH-CHART | Frontend pure display-boundary tests: exact tooltip strings, zero/tiny/large coordinates, omission of incomplete subtotal, linear UTC x-axis, no lines |
| VCH-API/UI | Two real password/MFA/HTTPS/backend/PG cases; actual period change/refresh, exact table, rendered chart, delayed real response and draft preservation |
| Integration | Scoped TS/Biome, backend/frontend builds/lints, frontend tests, dependency high/critical gate, strict OpenSpec |

Full backend/fullE2E, unchanged migration upgrade matrix, hostedCI, image/DAST/
release scans and production are not selected. Existing tests and CI gates remain;
full runner includes the new PG fixture. No fake backend/auth responses.

## Baseline and independent review

At9b1d652: `pnpm --dir backend test --runInBand --coverage=false historical-valuation
historical-accounting` passed68tests/3suites in1.836s. Active changes empty; contract
5a3e367 strictly validates with20items (19canonical+change). Sol found no contract
blocker and independently verified sampling boundaries, Decimal precision220
maximum oracle and real RR barrier. Root reviewed Luna acceptance, corrected an
array matcher and an impossible instrument-label assertion (series DTO has no
instrument labels), and strengthened exact web-first table/real period-change checks
before implementation. No intended amount/security assertion was weakened.

`pnpm audit:production` exited0 with2existingmoderate findings, no high/critical.
Log `/private/tmp/capital-chart-audit.log`; existing findings remain documented in
`docs/dependency-security.md`.

Preserved owner Nginx SHA256
115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432 (0644,1348bytes).
Lock SHA2566a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d.

## RED

Pending current predecessor run. It asserts previous image IDs before starting:
BEsha256:6585ed74167fb470aa4c5575e934759daf14f60adb2502b1ed0a84f3409b8fd4
FEsha256:f034307171dc39856cd16fe5bfe5ca177998584419324b90c9375de6279db4ea.
Missing future modules are prerequisites, never behavioral RED.

## Implementation, GREEN and archive

Pending actual results, independent review, preservation and canonical sync.
