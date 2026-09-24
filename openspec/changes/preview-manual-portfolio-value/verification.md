# Manual portfolio valuation verification

Status: contract/acceptance preparation; no implementation or GREEN claim.

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
