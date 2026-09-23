# Verification: known-cost carry-in

Status: CSV predecessor verified/archived; independently reviewed carry-in API/UI
acceptance demonstrated genuine missing-feature RED against its exact release images.
Carry-in implementation is now ready to begin. No carry-in GREEN is claimed.

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

## Verified predecessor and canonical reconciliation — 2026-09-23

CSV archive83ce99d followed actual complete124/124 Chromium GREEN in26.4m,
one worker/zero retries, all migration/PG/auth prerequisites, terminal exit0 and
independently confirmed synthetic cleanup. Exact predecessor backend/frontend:
`sha256:0c239e1e9b2994bd5468bc50ea9ededccf619b44022caf29e84999c18be99e46` /
`sha256:e973022048dc5f18608e381d93bcb7a49753efc0653ef37eb04c97164f4fdb4f`.
Every modified carry-in requirement was reconciled against those actual canonical
specs; all preceding scenario IDs remain. No product/schema change accompanied the
carry-in artifact integration. API/UI tests still require actual predecessor RED.

## Genuine predecessor-image RED — 2026-09-23

At source859e9b7, before any carry-in product/schema change, ran
`PATH=/private/tmp/capital-task-bin:/Users/pavelars/.nvm/versions/node/v22.23.2/bin:$PATH caffeinate -is node /private/tmp/capital-carry-in-predecessor-red.cjs`.
The runner asserted both exact CSV image IDs above, used `--no-build`, actual fresh15
migrations, real owner/password/MFA and opening APIs, release artifacts/topology and
PostgreSQL. Log `/private/tmp/capital-carry-in-predecessor-red.log`; preserved synthetic
failure artifacts `/private/tmp/capital-carry-in-red-artifacts`. Exit1: two tests,
two intended failures, one worker, zero retries.

- `carry-in-red.spec.ts:276`: real POST /trade-journal/carry-in expected201, received404.
- `carry-in-red.spec.ts:396`: protected heading `Начальные лоты FIFO` was absent after
  actual authentication and an existing known-cost opening were created successfully.

Neither failure depended on a future table/module. Finally checks preserved prior
opening/import/other-account rows, admissions and provider counts. Owned cleanup
completed; independent read-only Docker container/network inventories were empty.
The two maintained tests had already passed scoped strict TypeScript, Biome and
Playwright discovery before execution. Missing modules/build failures are not RED.
