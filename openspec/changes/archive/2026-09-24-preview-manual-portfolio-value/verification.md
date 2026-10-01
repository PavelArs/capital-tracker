# Manual portfolio valuation verification

Status: implemented, independently reviewed, targeted GREEN and archived.

Base122e3ca has21 canonical specs and no active changes before this proposal.
Owner chart maximum-period review remains deferred. Nginx edit/lock/data retained.

Keep: existing exact manual journals, FIFO/history/price stores, individual value,
chart and daily display FX; Nest/TypeORM/PostgreSQL, React, existing test tooling,
GHCR/Compose deployment. Simplify: compose existing read projectors inside one
snapshot; do not add parallel accounting math or sum paginated account lists.
Remove: nothing. No migration, dependency, provider, service or deployment change.

Selected checks: strict request and exact aggregate/gap unit cases; real PostgreSQL
ownership, coverage states, shared/distinct UUID prices, scale60,10-account bound,
actual concurrent RR barrier and all-business-row/provider fingerprints; retained
historical valuation PG family. Two new API/UI HTTPS cases plus retained VAL-UI,
real password/MFA/backend/PG and only controlled external providers. Backend
historical/valuation/chart characterization and relevant frontend tests; builds,
lints, production audit and strict OpenSpec validation. Full backend/full E2E,
older migration matrix, hostedCI, scans and production are not selected here;
existing CI tests/gates remain. Actual commands/results will follow, not inferred.

Baseline at3129270: `pnpm --dir backend test --runInBand --coverage=false
valuation-history historical-valuation historical-accounting` passed95/4 in1.669s,
`/private/tmp/capital-mpv-baseline.log`. Strict22items (21canonical+active) PASS.
Sol independent contract review found no blocking financial/privacy ambiguity,
requiring visible retained selection or explicit clearing if the catalog is replaced.
This requirement is recorded in design; opening revision is not journal revision.
Root pure tests f01879b and actual PG fixture8da7886 precede implementation; Sol
view tests6120717 similarly have no product modules yet. Missing imports are not
behavioral RED. Two actual predecessor HTTPS cases are being prepared.

## Behavioral RED and implementation

Luna's two-case acceptance0ae4b04 integrated4b0c864; root reviewed and corrected
fixture revision expectations and exact monetary/request-count oracles before
runtime. Sol view tests6120717 integrated8823465. Root8da7886 actual PG fixture
independently reviewed bySol: no material oracle/fixture issue.

At4b0c864, `/private/tmp/capital-mpv-red.cjs` ran against the prior accepted daily-FX
images, before any product edits. Actual HTTPS/login/MFA/backend/PG;2 expected
failures: valid owner preview expected200 got404, and missing Russian heading
`Оценка выбранных счетов` after10s. No environment/fixture failure counted as RED.
One worker, zero retries. `/private/tmp/capital-mpv-red.log` and
`/private/tmp/capital-mpv-red-artifacts`.
BEsha256:514843fb64d028cdbe63deda161654147d203b750faba5dd6c9cac32f1dba2d7
FEsha256:83370644fb9133219770465629851a07b3db933984f9a629d3c592fd5e24df71
Root7128c28 backend implementation followed actualRED; no existing projector/API
changed. Strict bounded owner set, nullable coverage, same RR manager, one union
price read and reused exact product projection. Shared full runner wiring504993a.

Targeted `pnpm --dir backend test --runInBand --coverage=false
manual-portfolio-valuation valuation-history historical-valuation historical-accounting`
passed127/5 (32new+95retained) in1.949s.
`/private/tmp/capital-mpv-backend-unit.log`. Backend build/scopedBiome/lint PASS
(77existing warnings), backend-build/backend-lint logs with same prefix. Production
audit exit0,2existing moderate findings/nohighcritical; unchanged lockfile.
`/private/tmp/capital-mpv-audit.log`.

## Actual PostgreSQL and source integration

At7128c28, `/private/tmp/capital-mpv-db.cjs` built the backend image and ran new
`manual-portfolio-valuation-db.cjs` plus retained `historical-valuation-db.cjs`.
`/private/tmp/capital-mpv-db.log`, exit0. Actual explicit schema19 migration in each
fresh synthetic database; no migration change introduced.

- MPV-EXACT/GAPS/PRIVATE PASS: shared UUID exact308.64, same-symbol distinct UUID and
  adjacent-instant gaps, missing journal/precoverage versus empty zero, price0 and
  voiding, strict request and whole-request owner isolation, all-row fingerprints.
- MPV-SNAPSHOT PASS: two actual connection pools/PIDs; pause the reader after its
  RR snapshot is established, correct both account journals and the shared price
  elsewhere, then prove unchanged old result30 and fresh result140. One union price
  read; READ ONLY/isolation statements and all-row preservation asserted.
- MPV-PRECISION/BOUND PASS: scale60 aggregate of two tiny products, selection10
  accepted/11refused, invalid saved FIFO remains409 with no repair/mutation.
  Ten accounts/two positions observed9ms; this is not an SLA or maximum11000-row
  benchmark. Existing single-account peak coverage remains in the retained fixture.
- Retained VAL-EXACT/GAPS/PRIVATE, VAL-COVERAGE, VAL-SNAPSHOT, VAL-PRECISION PASS.

Image `sha256:4b6bfc44032298aa1f4c8c342ad5ff9ac16c235d9bbf6c665fb58e227ae61c77`.
Controlled external fixture counters stay unchanged; no backend/repository mock.
Harness cleanup removed its synthetic containers/networks. No owner database.

Sol UI9d1b282 integrateda38901b. Root45cd0e9 clarified user-facing copy and stacked
narrow-screen summary fields; no mathematical/state assertion change. Selection is
stored visibly as records independent of the currently loaded catalog page, with
explicit removal, avoiding hidden submissions after a catalog replacement.
Sol independently reviewed backend7128c28 and reported no material bug; root reviewed
the UI state machine/exact view/API/table and preserved account creation/paging.

Frontend104tests/13files passed in2.97s (Sol worktree), production build/scopedBiome
PASS. Root integrated frontend build and lint PASS (29existing warnings; retained
>500kB bundle warning), logs `/private/tmp/capital-mpv-frontend-{build,lint}.log`.
Final browser strict/noUnused TypeScript PASS; `git diff --check` PASS. Changes use
no new package, migration or deployment topology.

## HTTPS and archive

At45cd0e9, `/private/tmp/capital-mpv-green.cjs` built both images, migrated/seeded
the isolated database, checked containment and ran:

`pnpm exec playwright test tests/e2e/manual-portfolio-valuation.spec.ts
tests/e2e/historical-valuation.spec.ts --grep 'MPV-|VAL-UI:' --workers=1`

Exit0, **3/3 in37.0s**, one worker, zero retries: MPV-API, MPV-UI and retained VAL-UI.
Actual HTTPS/password/MFA/session/backend/PostgreSQL. Only external providers are
controlled; delayed UI response uses actual `route.fetch()`, not a fabricated body.
Exact per-account/aggregate values, private request boundary, missing history/price
and saved zero, no provider/business writes, changed-time stale response and retained
single-account UI all asserted. No unexpected GREEN failure. Containment/artifact
checks PASS. Raw `/private/tmp/capital-mpv-green.log` and synthetic-only
`/private/tmp/capital-mpv-green-artifacts`.

- Backend `sha256:4b6bfc44032298aa1f4c8c342ad5ff9ac16c235d9bbf6c665fb58e227ae61c77`
  (same image as actual PostgreSQL verification).
- Frontend `sha256:92528857004478837265653aa1651f31b73783fa9c5bbbefdb1a45d4efb222b7`

Cleanup completed; live labeled container/network inventories empty. Owner Nginx
mode0644/size1348/SHA256
`115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432`
and lock SHA256
`6a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d`
unchanged. Strict OpenSpec22items (21canonical+active) PASS. No full backend/full E2E,
older migration matrix, hostedCI, release scans, live providers or production check
run in this slice; no tests/gates removed. No owner-data access/folder deletion/
remote push/paid services. Whole brief and chart maximum-period review remain open.

Installed OpenSpec1.2.0 `archive preview-manual-portfolio-value --yes` succeeded
with canonical synchronization, archive2026-09-24-preview-manual-portfolio-value.
The expected6/7 warning referred to3.3, which includes archive itself; marked7/7
only after actual success. Luna's final independent evidence audit found no
blocker. Strict22canonical specs pass,21previous specs byte-identical, new
requirements match the archived delta. Generated Purpose filled without modifying
requirements. Active changes empty after archive.
