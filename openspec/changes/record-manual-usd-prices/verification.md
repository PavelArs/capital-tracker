# Manual USD prices verification

Status: specified; acceptance and implementation pending.

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
full legacy upgrade matrix, release scans or production deployment is claimed.
