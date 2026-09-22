## Context

Checkpoint d679708 verifies exact client attribution through the real deployment
edge, 63 HTTPS Playwright scenarios, 505 backend tests and real PostgreSQL/CLI checks.
Authentication still uses process-local Throttler budgets. SessionGuard currently
touches a valid session before DTO/controller work; an account-only controller
limiter would consequently let denied re-login extend full-session idle time.

## Goals / Non-Goals

**Goals:** Shared 30/5/5-per60s source and10-per600s claimed-account admission, bounded
storage, correct concurrency/expiry, precise mutation boundaries and real replica
evidence. Preserve owner identity, CSRF, factor security and all financial state.

**Non-Goals:** General-route quota persistence, fairness, complete denial-of-service
protection, new authentication routes, limiter reset, deployment or owner-data access.
The existing Redis cache is unsuitable for security admissions because live entries
can be evicted; retain PostgreSQL as the single authoritative store.

## Decisions

### Stable policy and explicit ordering

Name policies csrf-ip30/60s, login-ip5/60s, mfa-ip5/60s, login-account10/600s.
Compose explicit policy metadata with the existing source marker and SkipThrottle
on exactly CSRF/login/MFA. Keep the generic Throttler unchanged elsewhere. Use the
existing SessionGuard for source admission so correctness does not depend on global
guard registration order:

1. Validate exact source, retaining400-before-any-mutation for malformed trusted metadata.
2. Commit the handler's source admission before session/factor work.
3. Apply existing session, owner binding/revision, Origin and CSRF authorization.
   Login/MFA authorization is explicitly read-only; preserve checks and row locks,
   omit only lastSeenAt update. Other routes retain existing activity touches.
4. Run the normal DTO validation. Login's normalized email stays bounded by its
   existing254-character semantics, with original password bytes and type defenses.
5. Commit login-account admission before AuthService.validateUser, including its
   credential owner lookup and real/dummy Argon2 verification.
6. Run unchanged transactional password rotation or factor completion, which must
   recheck state/revision/time after their locks. No ledger lock survives into them.

Session authorization may read owner binding before account admission: that is not
credential lookup or password verification. Valid parsed bad DTO/CSRF/session
requests spend only source admission. Invalid source spends nothing. Body-parser
syntax/size rejection precedes guards and has no promised admission. IP denial
spends no account slot. Committed admissions are never refunded after later failure.
Successful authentication spends the same admissions; CLI recovery/enrollment spends
none and never resets them. Existing MFA guesses/cooldown remain independent.

### Additive bounded ledger

Migration1790020000000 creates only auth_request_limits: composite key(scope,
subjectHash), integer hits, windowStartedAt/expiresAt timestamptz and expiry index.
SQL constraints allow the four scope names, lowercase64-hex digest, positive
scope-specific bounded hits, finite timestamps and exact60/600-second duration.
No user/session foreign key or existing row change.

Subject digest is SHA256 of UTF-8 JSON.stringify(['ct-auth-request-v1', scope,
canonicalSubject]). Source subjects reuse the verified v4:/32 or v6:/64 values;
account subjects use the existing trimmed lowercase validated email, without
provider aliases or extra Unicode normalization. Persist no raw IP/email. This
bounded representation does not promise anonymity for guessable identities.

Each admission uses a short independent transaction and advisory transaction lock
1763669184, distinct from migration1763669182/session1763669183. Set LOCAL
lock_timeout2s and statement_timeout5s before acquiring it. Prune expired rows,
lock the target if present, then evaluate expiry with fresh clock_timestamp after
all waits, including pruning. Keep comparisons/retry arithmetic in PostgreSQL to
preserve timestamp precision; do not use host or transaction-start time.

A live under-limit target increments once without changing start/deadline. A full
target denies without increment or extension. An expired target is removed. For
a missing target, count only rows live at the fresh decision time: below4096,
insert hits1 with a new fixed window; otherwise deny until the earliest live
deadline. Never evict live state. A pruning delay must not cause stale expiry or
false capacity decisions. Return an allowed/denied transaction outcome, commit,
then raise expected HTTP denial outside the transaction. Explicitly test pruning
commit, target expiry and global capacity under separate processes.

### Bounded failure and safe responses

Use runtime TypeORM connectTimeoutMS5000, mapped by installed0.3.31 to pg-pool's
connectionTimeoutMillis. This bounds all runtime pool acquisitions/new connections,
not just auth; it does not bound total requests or Nest startup retries. Keep CLI
DataSources unchanged. Avoid Promise.race around pending acquisition, which could
execute a late admission after refusal. Catch the entire admission transaction,
including checkout/commit; no automatic retry or memory fallback.

Expected denial returns429 Too many requests with no-store and integer Retry-After
ceil(deadline-now), clamped1..60 for source and1..600 for account/capacity. Use a
narrow typed denial handled by the existing global filter so Retry-After is an
actual header. Preserve other MFA/session429 contracts. Unexpected ledger failure
returns503 Authentication service unavailable/no-store without driver/identifier
details. Ambiguous commit may have spent a slot; return503 and never retry internally.

### Real acceptance and independent oracles

Add a second backend of the exact same image, DB, key and configuration to the
existing isolated Docker project. Retain client A/B isolation and real cookie jars.
Render the actual deployment template with synthetic backend upstream selection:
primary, replica or both. Disable upstream retries and record only source/upstream
addresses in a restricted synthetic Nginx log. No production debug endpoint,
auth bypass, mocked own backend or routing choice from client-supplied headers.

Before implementation, force A's five wrong passwords through primary then the
sixth through replica: expected429, old memory behavior401. Separately exhaust and
restart both before expecting429. Capture actual upstream/process evidence, without
future-table reads that could mask the behavioral RED. After implementation use
both replicas for concurrent and ordinary real HTTPS scenarios. Restart helpers
must verify both actual process lifetimes and independent health before ingress.

Reset only the new ledger between independent synthetic tests. Never reset it
inside persistence/restart/concurrency scenarios or via owner CLI. The reviewed
63-case inventory identifies34 fingerprint intervals requiring ledger-only
exclusion plus independently calculated exact deltas; retain all other fingerprint
scopes. Preserve the MFA five/restart/five assertions by using actual A/B sources,
then a third observed browser source for the owner cooldown. No weaker counters,
reset within the scenario or quota-disable flag.

Dedicated allowlisted PostgreSQL fixtures cover capacity4095+two-process race,
fresh clock after held target/prune locks, timeout503, fixed-window equality,
schema constraints, real pool checkout exhaustion and no late admission. Separate
source tests may instrument verifier/error boundaries; HTTP/DB positives remain
real. Preserve all old migration and authentication oracles, adding populated11→12
upgrade with all session/factor classes and exact prior-row fingerprints.

## Risks / Trade-offs

- A global advisory lock favors simple exact capacity over high throughput; bound
  waits and keep ledger transactions independent of expensive authentication.
- Shared capacity permits denial of new subjects at4096; existing under-limit
  subjects retain allowance. Finite windows do not guarantee owner availability.
- Failure after a committed source admission may spend no account slot or may fail
  later; conservative charges are intentional and never grant authentication.
- These fixed windows allow adjacent-boundary bursts. General routes still have
  process-local quotas; no complete DoS or production-readiness claim follows.

## Migration Plan

Run only synthetic explicit migration rehearsals here. Migration12 is additive;
keep every historical migration unchanged and destructive-preflight refusals intact.
The new runtime requires the ledger to admit auth requests; pending schema fails
closed. Old runtime can ignore the additional table but loses persistent protection;
do not drop the ledger on rollback or claim security equivalence. Production release
still needs separately authorized backup/recovery and rollout procedures.

## References and resolved review decisions

Installed TypeORM0.3.31 PostgresDriver and pg-pool3.13.0 were inspected for bounded
checkout cleanup. PostgreSQL16 primary documentation confirms changing
[clock_timestamp](https://www.postgresql.org/docs/16/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT),
[transaction advisory locks](https://www.postgresql.org/docs/16/explicit-locking.html#ADVISORY-LOCKS)
and [local timeout settings](https://www.postgresql.org/docs/16/runtime-config-client.html).
Independent pre-implementation reviews resolved source-attribution separation,
read-only authorization, prune-wait clocks, Retry-After header handling, precise
success charging and no finite owner-availability promise. No open product decision
blocks this bounded slice.
