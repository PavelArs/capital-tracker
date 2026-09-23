# Capital Tracker refactor continuity

## Goal and boundaries

Continue the full incremental refactor against capital-tracker-openspec-prompt.md.
The full goal is NOT complete. Preserve owner data and unrelated edits. No paid
services, production deployment, remote push or original-folder deletion occurred.
After the whole verified refactor, consolidate into capital-tracker-old and remove
only confirmed related duplicates under docs/consolidation-plan.md, preserving
history/configuration/user data first. Do not consolidate an incomplete slice.

Branch: refactor/brownfield-baseline. Root owns migrations, lockfiles, shared fixtures,
deployment and Docker. Use independent worktrees and reviewed integration; route
simple tasks to simpler models where supported. Keep code maintainable and provide
short periodic Russian updates. Future-work preferences are already saved in memory.
New agent spawning hit the platform thread limit; reuse audit_security,
gate_acceptance and provider_feasibility. All worktrees remain retained.

Preserve unstaged frontend/nginx.conf: SHA256
115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432,
mode0644, size1348. Current lock SHA256:
aa2588325aacdc54e8437d3500c7d2df580cc20cd061d1e3727f30f0dcc1e4f8. (csv-parse7.0.2 addition)

## Runtime and workflow

Project pins: Node22.21.1, pnpm10.33.0, OpenSpec1.2.0, Playwright1.63.0.
PG16.10, Docker29.5.3/Compose5.5.1. During the final USD run an external host update
removed Node22.21.1 and changed global pnpm to12.5.1. The running gate completed.
For NEW local commands use:
PATH=/private/tmp/capital-task-bin:/Users/pavelars/.nvm/versions/node/v22.23.2/bin:$PATH
The temporary pnpm wrapper invokes verified cached10.33.0 directly. Node22.23.2 is
within package engines. Do not change repository pins or global settings for this.
A global pnpm OpenSpec status attempt hung and was interrupted130; the local CLI passed.

OpenSpec actual commands: new change, status/instructions --change NAME --json,
validate --all --strict --no-interactive, archive NAME --yes. No verify command or
validate --change. Use installed propose/apply/archive skills; equivalent verification
is documented. Canonical specs describe implemented verified behavior. New behavior
needs actual acceptance RED; pure refactors retain passing characterization.

Root alone runs synthetic capital-tracker-e2e using tests/e2e/compose.yml, PG tmpfs.
Never production Compose or an owner DB. Docker/registry escalations were approved;
none rejected. Use caffeinate -is for long macOS runs; it is not a closed-lid guarantee.
Root HTTPS focused run active: PTY14067, /private/tmp/capital-csv-http-focused-first.log.
Runner /private/tmp/capital-csv-http-run.cjs; only external providers are stubbed.

## Completed and archived

Eleven slices: audit/baseline, isolated release acceptance, CLI owner, opaque sessions,
checkout preservation, mandatory MFA, dependency remediation, trusted client source,
persisted auth request limits, exact manual openings and exact USD FIFO trades.
Manual archive: 2026-09-23-record-manual-opening-positions (e2080aa), full85 GREEN.
Latest actual archive: 2026-09-23-record-usd-fifo-trades; six added requirements,
two modified, none removed. Complete history/evidence is in its verification.md.

USD product source verified at62e8f26; later changes are docs/spec sync and preserved
owner Nginx. Explicit attested empty origin, no opening-history conversion, exact
scale30 BigInt FIFO, full immutable corrections/terminal voids, replay-before-CAS,
1000 active/10000 version caps, coherent read-only RR and protected Russian UI.
Migration14 adds three empty journal tables and preserves predecessors. Read archived
persistence.md and canonical usd-fifo-trades before changing contracts.

Actual genuine predecessor HTTP/UI RED preceded implementation. Independent reviews
found/fixed refresh rebase and lost-response replay defects, including a real CSRF403
retry; four retained UI regressions now pass. Historical failure logs and all oracle
repairs are honestly recorded in archived verification; never weaken them.

Final source gate: /private/tmp/capital-usd-final-source-gates.log exit0, strict11,
backend/frontend lint/build,737 backend tests/24 suites,81 frontend tests/10 files,
183 engineering tests/2 suites included in737 and also separately invoked.
Frozen install/high-threshold live audit exit0;2 moderate Router advisories remain,
0 high/critical. Existing77/29 lint warnings and bundle warning remain documented.
Focused16: /private/tmp/capital-usd-focused-final.log exit0,4.0m,1worker0retries.
Full gate: caffeinate -is pnpm test:e2e, session21411 FINISHED exit0,
/private/tmp/capital-usd-release-full.log:101/101 Chromium,21.7m,1worker0retries,
plus all actual provider TLS, migration, PG/CLI/MFA/session/admission,27 startup
refusals, topology/artifact and checkout-preservation prerequisites.
Backend sha256:17283e22fdc410782a31ebdd86e627e8c07cb576fd1f0b82ffb9bc87e39fc2c3.
Frontend sha256:ebf4d8ce70cd660fc854459c6c84519fec7d54ab087a8019fc8f37f57a6234ad.
Owned cleanup completed; independent Docker reads empty; owner Nginx/lock unchanged.
Hosted CI, second browser, image/SAST/DAST/full ASVS and backup/restore remain unrun.

## Now and next

Active import-usd-trades-csv; all artifacts ready/strict12; genuine initial RED
recorded12eb619 on exact USD images, intended API404/missingheading, real auth/PG
preservation. Test initialcommitd435a86, independent122 boundaries126240d,
root input/parser/dependency63611f7, schema/proxy03ec6bc, backend3c11a38,
module/populated migration5ea3354, PGfixture755189a, HTTPsecuritydeb8611, UI83398d0.
Current task/evidence file has exact executed checks and pending items.

Backend full859tests/26suites, lint/build pass. Release backend image:
sha256:0c239e1e9b2994bd5468bc50ea9ededccf619b44022caf29e84999c18be99e46.
Actual fresh15/replay/populated8..14/refusal plus retained manual/USD PG pass:
/private/tmp/capital-csv-migration-regression-2.log. Initial attempt failed because
test helper lacked14 allowlist, fixed without changing expected behavior.
Actual CSV PG nine families pass /private/tmp/capital-csv-pg-first.log: exactFIFO,
whole-batch/replay, conditional rollback, process races, genuine deferred COMMIT,
RR barriers, SQL limits and valid caps. Root fixed fixture's foreign-journal seed
to retain all protected prior rows; no assertions weakened.
Frontend build/lint81tests pass; initial2 realHTTPS cases already passed in currently
running7-case focused set (security+wire remaining). Full gate not run; no archive.

Open frontend review findings require maintained runtime regressions before repair:
1. CSV refresh does not refresh parent unless recovering an accepted command.
2. New unuploaded file leaves old selected batch/inspection/mapping usable.
3. Exact source-key whitespace collapses visually.
4. Shared client401 hard navigation loses in-memory original commands. Root will
replace hard reload with minimal AuthProvider unauthorized SPA handling ONLY after
actual401 recovery RED. Full browser document reload is not persistent storage;
clarify in-app refresh scope while retaining denied401 command guarantees.

Agents reused: gate_acceptance owns new csv-import-journey.spec.ts/optionalfixtures,
prioritizes401 genuineRED then fullRussianFIFO/rollback/lostresponse403/stale review.
audit_security owns new csv-import-commands.spec.ts actualreplica/hash and deferred
COMMIT HTTP500/privacy. provider_feasibility prepares401 integration design only.
Root owns migration/lock/sharedfixtures/Docker/integration and all subsequent repairs.
Worktrees csv-acceptance, csv-backend, csv-frontend retained; no concurrency edits.
Root wire test independently reviewed; exact1MiB/oneover ContentLength+chunked,
fingerprint includesALLtables includingauthsessions on edge413. Follow-up security
strengthening: send validmultipart underdeniedauth ratherthanJSON; wait currentrun
before editing its live test files.

CSV scope remains UTF8<=256KiB/100rows, explicitowned UUID/USD/decimal/time/order/fee,
whole-batch atomic acceptance/provenance/conditional rollback,1000/10000journalcaps.
Originalbytesimmutable, sha+bytesexactdedup,256retainedfiles; no overlappingsemantic
dedup, openingconversion, carry-in or full-refactor completion claim.

Remaining full goal after CSV: carry-in/owned transfers/flows, performance XIRR/TWR,
DB-first price/FX/history, six-chain adapters/reconciliation, explicit optional free
AI, immutable promotion/security/backup restore, final requirements audit, consolidation.
