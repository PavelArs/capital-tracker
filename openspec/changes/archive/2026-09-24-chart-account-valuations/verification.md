# Account valuation history verification

Status: targeted GREEN, independent review and archive/sync complete.

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

Actual `/private/tmp/capital-chart-red.cjs` exited1: two expected failures before
product changes, anonymous series GET expected401 got404 and new history heading
absent after10s. Raw log `/private/tmp/capital-chart-red.log`, synthetic artifacts
`/private/tmp/capital-chart-red-artifacts`. Previous image IDs were asserted before
starting:
BEsha256:6585ed74167fb470aa4c5575e934759daf14f60adb2502b1ed0a84f3409b8fd4
FEsha256:f034307171dc39856cd16fe5bfe5ca177998584419324b90c9375de6279db4ea.
Missing future modules are prerequisites, never behavioral RED.

## Implementation, GREEN and archive

Backend GREEN: `pnpm --dir backend test --runInBand --coverage=false
valuation-history historical-valuation historical-accounting` passed95tests/4suites
in1.966s (27new,68retained). Backend build/scopedBiome passed; backend lint passed
with77existingwarnings. Log `/private/tmp/capital-chart-backend-lint.log`.

Sol committed frontend display-boundary tests42081e2 before UI5fdc42c; main received
them as7b07051/2935162. `pnpm --dir frontend test` passed98tests/11files in3.05s
in the isolated UI worktree. Frontend build/scopedBiome also passed there. On main,
`pnpm --dir frontend build` and `pnpm --dir frontend lint` passed; lint reports
29existingwarnings and Vite retains its >500kB chunk warning. Logs:
`/private/tmp/capital-chart-frontend-build.log` and
`/private/tmp/capital-chart-frontend-lint.log`. No lock/dependency change.

Strict scoped browser TypeScript passed after the final acceptance edit:
```
pnpm --dir frontend exec tsc --noEmit --strict --noUnusedLocals --noUnusedParameters --target ES2022 --module commonjs --moduleResolution node --esModuleInterop --skipLibCheck ../tests/e2e/valuation-history.spec.ts ../tests/e2e/historical-valuation.spec.ts
```
Root reviewed the UI/API/chart diff: exact strings remain separate from numeric
coordinates, incomplete points do not enter the dataset, and parent draft/generation
guards match the contract. Root strengthened the existing UI case in ad6dd63 with
an actual gap-only equal-endpoint response: table retained, unavailable-chart text,
no canvas and preserved draft. This adds no new E2E case. Sol independently reviewed
backend c3ef701..9f70991 and found no blocker: caller-owned RR, once-only history
loads, owner/index-scoped latest prices before void filtering, exact scale60 and
retained single-point response/error behavior. Luna supplied the guide; root reviews
all integrated diffs. Missing modules were never claimed as RED.

### Real PostgreSQL

At backend9f70991, `/private/tmp/capital-chart-db.cjs` built the backend image and
ran the production-compiled services against isolated PostgreSQL16.10. Each guarded
synthetic fixture uses all18 actual migrations. It exited0; raw log
`/private/tmp/capital-chart-db.log` records:

- `valuation-history-db.cjs`: VCH-TIMELINE/RANGE/PRIVATE, VCH-SNAPSHOT and VCH-MAX31
  all PASS. Exact values, price correction/void/zero, unchanged business fingerprints,
  separate-connection RR barrier and single reads of each source all passed.
- Maximum31 samples over100 carry-in lots plus1000 active trades passed the independent
  exact oracle in252ms on this host. This observation is not a latency guarantee.
- Retained `historical-valuation-db.cjs`: VAL-EXACT/GAPS/PRIVATE, VAL-COVERAGE,
  VAL-SNAPSHOT and VAL-PRECISION all PASS, preserving the shared-reader refactor.

No owner database or production service was accessed; isolated containers cleaned up.

### Real HTTPS Playwright

At sourcead6dd63, `/private/tmp/capital-chart-green.cjs` built and ran the isolated
application, seeded PostgreSQL, and passed artifact/network containment checks. It
ran only:
```
pnpm exec playwright test tests/e2e/valuation-history.spec.ts tests/e2e/historical-valuation.spec.ts --grep 'VCH-|VAL-UI:' --workers=1
```
Result:3/3 PASS in38.3s, one Chromium worker and zero retries: VCH-API, VCH-UI and
retained VAL-UI. Exit0; log `/private/tmp/capital-chart-green.log`, synthetic artifacts
`/private/tmp/capital-chart-green-artifacts`. Real password/MFA/backend/PostgreSQL,
no mocked application/auth responses. Only providers are stubbed; delayed delivery
uses the actual `route.fetch()` result. All intended negative/security/financial
assertions remain. No unexpected GREEN failures occurred.

Backend image (same in PG and HTTPS):
`sha256:9dcf0eaf717e063e7b198265498057471066dbdf57732aa23f41b2c9205d28e0`.
Frontend image:
`sha256:c9456cdf239a2a6b05e12a58b4e070d7930f1dcd407932f489f6f579b04b9d1e`.

Full backend/fullE2E, migration upgrade matrix, hostedCI and production were not run
for this slice. Their absence is intentional scoped verification, not a success claim.
Existing CI/deployment configuration and all prior tests remain intact.

### Archive

Luna independently audited the guide, tests and evidence against PG/HTTPS logs:
no blocker or overstated result found. All implementation/review/verification
artifacts are complete. Pre-archive strict validation passed20items,0failed.
Owner Nginx bytes/mode and lock hash match the recorded baseline. CI/deployment
files are unchanged. After cleanup, live Compose-label container and network
inventories were empty. `git diff --check` passed.

The installed `OPENSPEC_TELEMETRY=0 openspec archive chart-account-valuations --yes`
completed successfully and synced3 added requirements into the new canonical
`account-valuation-history` spec. It reported6/7 tasks because the self-referential
archive task was intentionally left unchecked until execution. The generated
placeholder Purpose is replaced with the implemented scope. Final
`openspec validate --all --strict --no-interactive` passed20 canonical specs,
0failed; `openspec list --json` returned no active changes. Byte comparison to
9b1d652 confirmed all19 previous canonical specs unchanged; the new canonical
requirements exactly match the archived delta. All7 tasks are complete after
archive/sync. Final Nginx/lock hashes still match baseline and `git diff --check`
passes. No product or acceptance code changed after the passing HTTPS run.
