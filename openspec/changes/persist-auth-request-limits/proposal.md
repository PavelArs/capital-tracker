## Why

Verified source attribution now separates real clients, but authentication request
limits still reset on restart and multiply across backend processes. A shared,
bounded PostgreSQL budget must also limit guesses against one claimed account before
password verification.

## What Changes

- Persist the existing 30/5/5 per-minute authentication source budgets and add a
  normalized claimed-email 10-per-ten-minute password admission budget.
- Commit admission before expensive authentication, with explicit read-only
  login/MFA session checks and safe denial/storage-failure responses.
- Add one data-preserving ledger migration with fixed windows, bounded live capacity,
  database time, finite lock/connection waits and no live-budget eviction.
- Verify actual shared admission through two real backend replicas and preserve all
  existing authentication, CLI, financial and browser assertions.

## Capabilities

### New Capabilities

- `auth-request-limits`: persistent source/account admissions, exact charging order,
  concurrency/capacity, fixed-window expiry and safe failure semantics.

### Modified Capabilities

- `auth-client-attribution`: update the documented persistence limitation after shared
  authentication budgets are proven; retain exact trust and edge sanitization.
- `owner-sessions`: distinguish committed request admission from unchanged session/
  financial state and require read-only login/MFA admission authorization.
- `explicit-migrations`: advance the verified fresh schema to twelve migrations while
  retaining all historical destructive-upgrade refusals and preservation scenarios.

## Impact

Depends on archived, verified `attribute-auth-client-addresses` at local checkpoint
d679708. Affects a small admission service, auth metadata/guard/controller, runtime
pool timeout, one additive table, isolated two-replica fixtures and operator evidence.
No new dependency/service, owner-data deletion, public endpoint or production rollout.
Preserve the owner's Nginx configuration and all existing data.

Non-goals: general API quota persistence, multi-CDN trust, fairness/reserved owner
capacity, complete DoS protection, a limiter-reset API, recent-MFA controls, accounting,
or release readiness. Redis remains outside security admission. CLI recovery does
not reset request windows; a finite window does not guarantee owner availability
under repeated hostile traffic.
