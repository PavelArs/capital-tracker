# Manual portfolio valuation verification

Status: behavioral RED confirmed, backend implemented; real PostgreSQL and frontend pending.

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

Real PostgreSQL/HTTPS GREEN, independent product review and archive pending.
