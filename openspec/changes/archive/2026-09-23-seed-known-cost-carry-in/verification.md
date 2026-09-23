# Verification: known-cost carry-in

Status: carry-in implementation and independent review are complete. The final full
release gate at59863bf passed133/133 Chromium in28.9m with exit0, plus all real
PostgreSQL/migration/authentication/startup/artifact prerequisites. Exact evidence and
earlier failed attempts are retained below. This bounded slice was archived with the supported
OpenSpec CLI; the full target brief and production release remain incomplete.

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

## Full release attempt and fixture prerequisite repair — 2026-09-23

At89846b3, `caffeinate -is pnpm test:e2e` exited1 before browser execution:
`/private/tmp/capital-carry-in-release-full.log`. Provider TLS, fresh16/replay,
all populated upgrades including15-to16 and unsafe legacy refusals passed. The
old auth-limits DB fixture stopped at its hardcoded15-migration prerequisite.
A targeted scan also found both startup fixture count/show assertions still15.
Root changed only those three counts to16 and the matching descriptive word.
An independent gpt-6-luna review confirmed agreement with the exact16-name ledger
and unchanged database fingerprint, startup/refusal and CLI-read-only oracles.
Both CJS files passed node --check. No product/security behavior or expected financial
result changed; this is a fixture version update, not acceptance RED. Runner cleanup
completed. The complete gate must be rerun before any release-pass claim.

## Full release result and accessibility regression — 2026-09-23

At524647f, `caffeinate -is pnpm test:e2e` completed exit1:132/133 Chromium passed,
one failed in28.8m,1worker0retries. Log `/private/tmp/capital-carry-in-release-final.log`;
artifacts `/private/tmp/capital-carry-in-release-failed-artifacts`. All provider TLS,
fresh16/replay/populated8..15 upgrade/legacy refusal, PostgreSQL, owner CLI/session/MFA,
27 startup refusal and artifact/topology prerequisites passed. Exact rebuilt images:

- Backend sha256:36856553e640b6906894d3e70dc8122548b31e7b84a699777344699e008da315
- Frontend sha256:c4a616a5391df772b6a5f8ad5f3f8e2f6e2713b7dc4b260f86a9811004d7f55c

`manual-opening.spec.ts:301` expected a single alert after actual stale-opening409;
the browser exposed two: the correct action conflict and the new persistent carry-in
unknown-cost explanation. The unchanged predecessor assertion caught an accessibility
regression, not a financial failure or setup error. Intermediate root status messages
mistakenly relied on latest test indexes and missed this earlier failure; corrected
to the owner once the terminal summary was inspected. No complete-pass claim stands.

The independent gpt-6-luna reviewer agreed that persistent eligibility context belongs
in a visible non-urgent note, retaining unknown-cost refusal/text and genuine action/
accepted-recovery alerts. This also follows the distinction in the
[W3C alert guidance](https://www.w3.org/WAI/ARIA/apg/patterns/alert/) between attention-
requiring messages and excessive interruptions. Added CARRY-005-B and changed only
the new carry-in guidance assertion to require a visible note and no matching alert;
the original stale-opening conflict/financial/privacy checks remain unchanged.
No product fix is yet claimed here. Focused genuine RED/GREEN is recorded below once run.

Independent synthetic container/network inventories were empty after runner cleanup;
owner Nginx SHA256115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432
and lock SHA256aa2588325aacdc54e8437d3500c7d2df580cc20cd061d1e3727f30f0dcc1e4f8
were unchanged. Archive tasks remain incomplete.

### CARRY-005-B observed RED, minimal fix and focused GREEN

`caffeinate -is node /private/tmp/capital-carry-in-note-red.cjs` checked both exact
release image IDs above and used no rebuild. Exit1, two intended failures: note was
absent in the unknown-cost case and the unchanged opening conflict still exposed two
alerts. Log `/private/tmp/capital-carry-in-note-red.log`; preserved artifacts
`/private/tmp/capital-carry-in-note-red-artifacts`. Both used real password/MFA,
PostgreSQL and HTTPS; neither failed on setup, imports or fixtures.

The sole product edit changes the persistent unknown-cost paragraph from alert to
note and applies existing visible warning styling. Its text, server refusal, consent,
and real error/recovery alerts are unchanged. A separate reviewer checked the exact
product/spec/test diff and reported no blocker; it performed no runtime verification.

`caffeinate -is node /private/tmp/capital-carry-in-note-green.cjs tests/e2e/manual-opening.spec.ts:260 tests/e2e/carry-in-journey.spec.ts:144`
rebuilt only frontend and passed2/2 Chromium in25.3s,1worker0retries, exit0. Log
`/private/tmp/capital-carry-in-note-green.log`. Backend image remains36856553e640;
exact frontend sha256:f81445af15fe1c9f48c39ee13118bbdd0e00c8060d91676a72fcbed8f1868c0a.
Independent container/network inventories were empty, and owner Nginx/lock hashes
were unchanged again. No financial or predecessor opening assertion was weakened.

Frontend lint/build/95 tests across10 files passed, exit0
(`/private/tmp/capital-carry-in-note-frontend.log`); existing29 lint warnings and
bundle-size warning remain. Strict E2E TypeScript and OpenSpec13/13 passed, exit0
(`capital-carry-in-note-tsc.log`, `capital-carry-in-note-spec.log`, /private/tmp).
Unchanged backend/dependency checks remain as recorded. Complete release rerun is
still required; this focused result does not close archive tasks.

## Deterministic warm-cache fixture — 2026-09-23

Full rerun atc20e465 (`/private/tmp/capital-carry-in-release-verified.log`) encountered
CSV-001-A restart failure: the provider list included a fiat-rate startup fetch when
the real Redis entry crossed its default600000ms lifetime. The existing startup
helper intentionally expects exactly two crypto constructor requests with a warm
cache. Application accounting made no new provider call; the failing assertion was
restart setup, not a changed financial result. Root stopped only the owned Playwright
process with SIGINT after identifying the failure, allowing runner finally cleanup.
Terminal exit1:62 passed,1 failed,1 interrupted,69 not run,14.6m. This is an incomplete,
failed gate. Artifacts: `/private/tmp/capital-carry-in-cache-failed-artifacts`.

Independent review confirmed that explicit warm-cache fixture configuration preserves
this test's contract. The synthetic Compose anchor now sets the supported
EXCHANGE_RATES_CACHE_TTL=86400000; both real replicas retain rates obtained by actual
startup throughout the bounded suite. Production remains at its existing default.
Artifact checks require that actual environment value and exact replica equality.
No CSV test, provider expected array, backend adapter, authentication or production
configuration changed. These warm-cache cases do not claim expiry-behavior coverage.

`caffeinate -is node /private/tmp/capital-carry-in-cache-focused.cjs` asserted exact
backend36856553e640/frontendf81445af15fe images without rebuilding and passed the
unchanged CSV/restart case,1/1 Chromium in18.4s, exit0,1worker0retries. Log
`/private/tmp/capital-carry-in-cache-focused.log`. Actual startup/Redis/PostgreSQL/MFA
and strengthened artifact checks were used. This is fixture determinism with retained
strict characterization, not a manufactured new-feature RED. Independent exact-diff
review found no weakened oracle. Artifact script syntax passed; source checks remain
valid because product code is unchanged. Owner Nginx/lock hashes remained unchanged.
The complete gate must restart from the beginning before archival.

## Complete release GREEN — 2026-09-23

At59863bf, actual command
`PATH=/private/tmp/capital-task-bin:/Users/pavelars/.nvm/versions/node/v22.23.2/bin:$PATH caffeinate -is pnpm test:e2e`
completed with terminal exit0. Full log:
`/private/tmp/capital-carry-in-release-complete.log`.

-133/133 Chromium passed in28.9m, one worker and zero retries;124 predecessor cases
 and9 carry-in cases, including the strengthened CARRY-005-B and JSON413 assertions.
-Provider TLS/CONNECT, fresh16/replay/populated8..15 upgrades and unsafe legacy
 refusals, all auth-limit/opening/USD/CSV/carry-in real PostgreSQL families, owner
 CLI/session/MFA/expiry,27 startup refusals and actual topology/artifact checks passed.
-Backend sha256:36856553e640b6906894d3e70dc8122548b31e7b84a699777344699e008da315.
-Frontend sha256:f81445af15fe1c9f48c39ee13118bbdd0e00c8060d91676a72fcbed8f1868c0a.

Independent Docker inventories after terminal completion found no containers or
networks carrying the synthetic project label. Owner Nginx remained0644/1348 bytes,
SHA256115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432;
pnpm-lock SHA256aa2588325aacdc54e8437d3500c7d2df580cc20cd061d1e3727f30f0dcc1e4f8.
The owner's unstaged Nginx change is intentionally retained. No owner database,
production deployment, remote push or repository consolidation was performed.

The source checks, independent reviews and exact RED/GREEN evidence above remain
applicable to this integrated source; later changes are documentation/archival only.
All ten modified canonical requirements retain their predecessor scenario headings;
six new carry-in requirements cover the new behavior. Historical failed/partial
runs are not counted as successful verification. Hosted CI, a second browser engine,
backup/restore and completion of the full brief remain unrun/unfulfilled.

## Supported archival — 2026-09-23

`OPENSPEC_TELEMETRY=0 openspec archive seed-known-cost-carry-in --yes` exited0,
synchronized five capabilities (+6requirements,~10modified,-0removed), and moved
this change into2026-09-23-seed-known-cost-carry-in. The only unchecked task was
6.4, archival itself, and was completed after this command and canonical validation.
All predecessor scenario headings were independently compared with pre-archive
canonical HEAD and retained across all ten modified requirements. A first local
comparison helper used an overly greedy regex and failed; its corrected check
passed. This helper issue was not an application or specification regression.

Canonical `openspec validate --all --strict --no-interactive` passed13/13 specs,
exit0; log `/private/tmp/capital-carry-in-archive-validation.log`. Canonical purpose
and documentation archive links were updated after the generated archive. No source,
image, schema, dependency or financial/security assertion changed during archival.
