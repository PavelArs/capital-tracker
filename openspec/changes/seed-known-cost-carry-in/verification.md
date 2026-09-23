# Verification: known-cost carry-in

Status: isolated specification preparation. No carry-in product implementation,
acceptance execution, migration or GREEN is claimed. The current CSV full release
gate must complete and its change must be archived before predecessor RED.

## Traceability and evidence to collect

| Scenarios | Independent executable evidence required |
| --- | --- |
| CARRY-001-A, CARRY-004-A | Real password/MFA HTTPS UI/API; PostgreSQL evidence; exact250/100/0.5; same manual/CSV baseline; restart/correction/rollback and retained provenance |
| CARRY-001-B, CARRY-002-B | Strict input and reconciliation tests; actual unknown/stale/foreign/raw failures without persistent mutations |
| CARRY-002-A/B | Independently computed atom-sized cumulative-offset and bound vectors; unchanged empty-origin characterization |
| CARRY-003-A/B | Real concurrent processes/account locks; canonical replay before mutable checks; deferred COMMIT stage witness plus complete rollback/retry |
| CARRY-004-A | Caller-owned snapshot barriers and bounded continuation; full history, exact receipts and CSV original preservation |
| CARRY-005-A | Real stale/late requests, response delivery loss, actual auth/CSRF recovery and SPA remount; no own-backend/auth mocks |
| CARRY-006-A, CARRY-MIG-001 | Real route privacy/CSRF, PostgreSQL finite/composite constraints and old-row/schema preservation; release-image upgrade/replay/refusal checks |

Record exact commands, relevant assertion failures, source commits/images, exit codes
and test counts as they occur. Missing modules, unavailable tools or fixture failures
are not a behavior RED. Preserve successful predecessor characterizations for pure
refactors. Hosted CI, another browser engine, backup/restore and production operations
remain unrun unless separately executed and evidenced; this document is not proof of
a full production release or completion of the target brief.

## Contract review and actual predecessor catalog — 2026-09-23

Separate architecture and acceptance contexts reviewed the wire/schema, exact partial
allocation, replay ordering, complete seeded calculation, unchanged empty-origin
projections, migration preservation and Russian review/recovery journeys. Resolved
wording ambiguities before implementation: fresh16; true trade-versus-carry-in
provenance; accepted replay conflicts on changed original evidence rather than
claiming arithmetic can establish historical truth; distinct empty-origin/first-
opening and carry-in/opening-replacement races. Shared seams and labels are frozen
in persistence.md. No remaining review blocker was reported.

Actual OpenSpec1.2.0 strict validation in isolated design worktree passed13 items,
exit0. This includes canonical predecessor specs plus the active CSV and draft
carry-in changes; it is artifact validation, not carry-in implementation success.

Read-only query against the running synthetic PostgreSQL16.10 CSV predecessor:
`docker exec capital-tracker-e2e-postgres-1 psql -U capital_e2e -d capital_tracker_e2e -Atc "SELECT conname,pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='account_trade_journals'::regclass AND contype='c' ORDER BY conname"`.
Exit0 confirmed the quoted replacement target
`account_trade_journals_originKind_check`, alongside unchanged coverageFrom,
createdAt and currentRevision checks. No schema/row mutation or owner DB access.
The migration has not been written or executed. Independent API/UI acceptance is
being authored in its own worktree; RED execution still awaits verified CSV archive.
