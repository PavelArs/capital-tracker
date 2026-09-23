# Verification: known-cost carry-in

Status: CSV predecessor verified/archived; independently reviewed carry-in API/UI
acceptance demonstrated genuine missing-feature RED against its exact release images.
Carry-in is implemented and has source, real PostgreSQL and focused HTTPS GREEN
evidence below. A JSON transport defect was reproduced and fixed with real HTTPS GREEN. The
complete release gate remains pending; final independent review is recorded below.

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

## Reviewed domain/service source — 2026-09-23

Independent test19bc3f9 (integrated5eaae87) was separately reviewed without oracle
blocker before domain implementation. Service/API dac62c3 was reviewed and integrated
36c6ed6; root shared domain/baseline/manual-CSV/opening projector integration7175f50
received independent review without blocking findings. No old test assertion changed.

Actual backend build exit0 (`/private/tmp/capital-carry-in-backend-first-build.log`);
full Jest898 tests/28 suites exit0 in10.457s
(`/private/tmp/capital-carry-in-backend-tests-first.log`). Focused new input/FIFO plus
retained FIFO58 tests/3 suites passed in1.94s
(`/private/tmp/capital-carry-in-pure-first.log`). Scoped backend Biome passed after
correcting an initial workspace-root invocation where the binary was unavailable.
That tooling error is not behaviorRED. Independent reviewer also built the combined
service/shared source successfully. At that point these were source checks only;
subsequent migration/PG/HTTP results are recorded below.

## Additive storage and real PostgreSQL results — 2026-09-23

Reviewed frontend4e51d43 is integrated ase31a0d8; its recorded build/lint and95
frontend tests passed. Root added migration16/entities and populated15 upgrade
fixtures, preserving all predecessor checks. New backend release build succeeded:
`sha256:ce10d4b64c06b11e3f4f71294f7ae3bf3c9d286f0dc684be3081d342f54e0186`.

Actual isolated commands use `caffeinate -is node /private/tmp/capital-csv-pg-run.cjs`
with production service modules, synchronize:false and temporary PostgreSQL16.10:

- `migrations manual-opening-db usd-trades-db csv-import-db carry-in-db`:
  log `/private/tmp/capital-carry-in-pg-first.log`, exit1. All fresh16/replay,
  populated8..15 upgrade/preservation and unsafe legacy refusals passed. The next
  opening fixture stopped on its stale15 migration-count prerequisite.
- `manual-opening-db usd-trades-db csv-import-db carry-in-db`:
  log `/private/tmp/capital-carry-in-pg-second.log`, exit1. Opening suite passed;
  USD SQL metadata assertion still expected every journal column to be non-null.
- After narrowly updating the count to16, asserting the exact new migration name
  and allowing ONLY account_trade_journals.openingRevision to be nullable integer,
  `usd-trades-db csv-import-db carry-in-db` completed exit0:
  `/private/tmp/capital-carry-in-pg-third.log`. Retained USD and CSV suites and all
  eight carry-in families passed: strict reconciliation, original allocation phase,
  manual/CSV250/100 and correction230, exact rollback/replay, independent-process
  account-lock races, deferred COMMIT complete-write witness/rollback, actual SQL
  integrity, five coherent RR read barriers,100 baseline lots plus1000 active trades.

No financial/security expected amounts or prior-column constraints were weakened.
These setup-contract repairs are not new behavior RED. Fixtures preserved all prior
financial/authentication rows, original CSV bytes and historical receipts. Each
runner removed its synthetic containers/network. Expanded browser/security coverage
and the complete release gate remain pending; this is not archive approval.

## Focused HTTPS and browser evidence — 2026-09-23

`caffeinate -is node /private/tmp/capital-carry-in-http-run.cjs` verified the backend
image above and preserved owner Nginx while building frontend. Real migrations,
seeded password/MFA, HTTPS/proxy and PostgreSQL were used, one worker, zero retries.

- `/private/tmp/capital-carry-in-http-first.log`: exit0,2/2 Chromium in31.2s.
  Original independent RED cases now pass exact250/100/0.5, revision0, immutable
  provenance and restart, plus separate unchecked Russian owner consent.
- Common setup was extracted to `tests/e2e/carry-in-fixtures.ts`; the original
  acceptance/financial assertions are retained. Root authored the expanded tests
  after the QA agent hit its usage limit; do not call that work independently authored.
- `/private/tmp/capital-carry-in-http-expanded.log`: exit1,5 passed/2 failed in1.9m.
  Original2, actual401/MFA/SPA original-key recovery and both route/privacy groups
  passed. Two fixture assumptions failed: consent is disabled/unchecked, not removed;
  baseline-page URLs include query parameters, so an exact glob did not inject loss.
  Corrected to assert both disabled and unchecked consent, and match the real URL.
- `/private/tmp/capital-carry-in-http-targeted.log`: exit1,2 passed/1 failed in36.6s.
  Late response/edit/stale opening/unknown cost and accepted-receipt/read-loss passed.
  CSV helper was called without its explicit sale vector, so it expected its default
  buy source. Passing the independently fixed sale vector retains exact source cells.
- `/private/tmp/capital-carry-in-http-last-focused.log`: exit1,2 passed/1 failed in37.5s.
  Manual/CSV250/100, correction230, baseline rollback, exact original bytes/receipts,
  and actual deferred HTTP COMMIT500 with complete-write witness/rollback all passed.
  The new102401-byte JSON probe exposed a genuine product defect: expected413,
  actual500. No expected accounting or privacy assertion was changed.

### JSON size refusal regression

CARRY-006-B makes the existing102400-byte envelope boundary explicit: a valid padded
preview at the bound remains200/read-only; one excess byte is a fixed private413.
The installed raw-body implementation creates an Error with type entity.too.large
and status413; the global Nest filter previously reclassified all non-HttpException
errors as500. No body limit, dependency or authentication rule is changed.

Focused unit RED `/private/tmp/capital-carry-in-json-unit-red.log`: exit1, expected413
received500 (1 failed,3 passed,35 unrelated cases filtered out). The minimal filter
fix recognizes only that Error/type/status combination and returns fixed public text;
unrelated status-like errors retain generic500. Full request-admission suite GREEN:
`/private/tmp/capital-carry-in-json-unit-green.log`, exit0,39/39. This new filter change
and root-authored acceptance/migration fixtures still require independent final review.

### Scenario links

- CARRY-001/002: `carry-in-red.spec.ts`, `carry-in-journey.spec.ts`,
  `carry-in-security.spec.ts`, `carry-in-db.cjs`, backend carry-in input/FIFO tests.
- CARRY-003: real process races and complete-write COMMIT witnesses in
  `carry-in-db.cjs`; actual private HTTP500/retry in `carry-in-security.spec.ts`.
- CARRY-004: `carry-in-csv.spec.ts`, retained original RED cases and real snapshot
  barriers in `carry-in-db.cjs`.
- CARRY-005: `carry-in-journey.spec.ts` and original Russian consent acceptance.
- CARRY-006-A/B: `carry-in-security.spec.ts`, request-admission filter tests,
  `carry-in-db.cjs`; CARRY-MIG-001: `migrations.cjs` populated15-to16 preservation.

These focused runs do not replace the complete release gate, independent review or
canonical archival. Owner Nginx/lock hashes stayed unchanged after completed runners.

## Integrated focused GREEN — 2026-09-23

`caffeinate -is node /private/tmp/capital-carry-in-http-run.cjs` with all four
carry-in spec files completed exit0:9/9 Chromium,2.0m,1worker0retries. Log
`/private/tmp/capital-carry-in-http-integrated.log`. This includes the exact102400-byte
read-only preview,102401-byte413 refusal and original-key retry, alongside every
new financial, privacy, recovery and COMMIT assertion described above.

Exact release images used:
- Backend sha256:60d3225df079dd372d698846b63dfc3ea15244d3fd446c33538afa2a1c6dd1e4
- Frontend sha256:c4a616a5391df772b6a5f8ad5f3f8e2f6e2713b7dc4b260f86a9811004d7f55c

Full backend Jest902/28 passed11.333s, backend lint passed with existing77 warnings,
strict OpenSpec13/13 and strict E2E TypeScript passed. Logs respectively:
`capital-carry-in-backend-final-tests.log`, `capital-carry-in-backend-final-lint.log`,
`capital-carry-in-spec-final.log`, `capital-carry-in-e2e-tsc-final.log`, in /private/tmp.
The Docker build compiled the integrated backend successfully. Earlier reviewed
frontend build/lint95 tests remain recorded above; no new final frontend/audit gate
is claimed. Independent read-only Docker inventory after cleanup found no synthetic
containers or networks. Owner Nginx/lock SHA256 remained exactly as in CONTINUITY.md.

The root-authored test additions, populated migration fixture and new global filter
fix still require independent final review. Full133-case release acceptance, current
frozen-install/dependency gate, remaining documentation review and archival are NOT
complete. Nine focused cases are not a claim that all predecessor browser scenarios
were rerun on the new image.

## Final independent review and source readiness — 2026-09-23

Security/data-integrity reviewer independently inspected detached46ce63f, building on
its previous source/schema/client review. No product, migration or filter blocker.
It requested two stronger test oracles: preserve other accounts' CSV original/command/
link rows, and assert exact auth-ledger deltas in accepted-receipt/read-loss coverage.
Root applied both without changing any financial/replay expected result. The reviewer
then checked the exact three test diffs and confirmed both findings closed. No runtime
checks are attributed to that read-only review.

A separate explicitly selected gpt-6-luna context reviewed bounded documentation.
Root corrected stale deferred-carry-in claims, explicit cumulative-offset wording,
migration16 preservation/count and old-binary compatibility. That context reviewed
all five revised guides and confirmed closure; it ran no tests.

Actual strengthened focused run: `/private/tmp/capital-carry-in-review-focused.log`,
exit0,2/2 Chromium in25.9s,1worker0retries on the same release images as above. Strict
E2E TypeScript passed (`capital-carry-in-review-tsc.log`). These are passing stronger
characterizations, not a manufactured behavior RED. Product code is unchanged from
46ce63f and retains the recorded902/28 backend checks, backend build/lint and strict13.

Remaining source gates were executed at integrated46ce63f: frozen lockfile install
exit0 (`capital-carry-in-frozen-install.log`), live production high/critical audit
exit0 (`capital-carry-in-final-audit.log`),0 high/critical and2 existing moderate Router
findings; frontend lint/build/95 tests across10 files exit0
(`capital-carry-in-final-frontend.log`). Existing77 backend/29 frontend warnings and
629.42kB frontend bundle warning are retained, not hidden. No dependency/pin change.
All log paths in this paragraph are under /private/tmp.

The complete release gate is next. Do not treat focused tests as proof that all
predecessor browser/security/CLI/startup cases passed on this release.
