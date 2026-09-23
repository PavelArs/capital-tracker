# Continuity Ledger

## Goal and constraints

Complete capital-tracker-openspec-prompt.md incrementally using OpenSpec and ATDD.
The full refactor is NOT complete. Only after the full verified replacement, consolidate
into /Users/pavelars/Projects/capital-tracker-old and remove confirmed duplicates,
preserving Git histories/stashes/configuration/data and unrelated apps. Read
docs/consolidation-plan.md. No push, production deployment, owner DB access or original
folder removal has occurred. No paid services. Only external providers may be mocked.

Branch refactor/brownfield-baseline. Root owns migrations, shared fixtures, lockfiles
and deployment. Use independent worktrees and bounded ownership; simpler models for
straightforward work, stronger for architecture/security/review. Keep code simple,
clean and compatible. Give short periodic Russian updates. Both future-work preferences
were explicitly saved to memory notes on2026-09-22. New agent spawn and old frontend
wake hit platform thread limit on2026-09-23; existing3 agents remain reusable.

Preserve unstaged owner frontend/nginx.conf: SHA256
115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432,
mode0644,size1348. Lock SHA256 remains
13e4fbf1d1effcf66367ef7829885eb53b339cb9f52ab43854ca2e4ba77c4e73.

## Runtime and workflow

PATH=/Users/pavelars/.nvm/versions/node/v22.21.1/bin:$PATH; default Node20 fails.
pnpm10.33.0, OpenSpec1.2.0, Playwright1.63.0, PostgreSQL16.10, Docker29.5.3,
Compose5.5.1. Docker/registry require reviewed escalation; none rejected so far.
Only synthetic capital-tracker-e2e project/tests/e2e/compose.yml, PostgreSQL tmpfs;
never production Compose. Root alone owns Docker. On macOS use caffeinate -is around
long runs; it prevents automatic sleep, not a guarantee with a closed lid.
OpenSpec actual commands: new change/status/instructions/validate --all --strict
--no-interactive/archive NAME --yes. No verify or validate --change. Fill generated
canonical Purpose and trim EOF whitespace after archive. Never manufacture RED.

## Verified and archived

Ten slices: baseline, isolated release acceptance, CLI owner, opaque sessions,
checkout preservation, mandatory MFA, dependency remediation, trusted client source,
persistent auth request limits, exact manual opening positions.
Latest actual archive:2026-09-23-record-manual-opening-positions; canonical OPEN/MIG
synced. Four additive manual tables/migration13 preserve all prior data; exact strings,
known/unknown cost, UUID identity, immutable account-locked replacement/replay/CAS,
protected Russian UI and bounded history. No CSV/trades/FIFO/valuation claim.

Manual preceding-image real MFA HTTP/UI RED exit1: API201 expected/404 actual and
missing page. Focused PG migration/race/rollback and initial API GREEN passed.
Source capital-manual-baseline-first.log exit0:667 backend/22 suites,81 frontend/10
files, both lint/build; frozen install and high-threshold audit exit0. Existing77/29
lint warnings, bundle warning and2 documented moderate Router findings remain.
After fixture repair, engineering183/2 suites and strict OpenSpec/diff checks passed.

First full85 run exited1:77pass/8fail1.5h. One provider oracle included2 retained
constructor warmups; corrected tozero accounting calls plus exactly2 startup calls.
One pre-body replica readiness failure led to synthetic shared64KiB Nginx upstream
zone; actualtwo-address oracle unchanged, historical cause not asserted proven.
Five retained failures match618/899s macOS sleep pauses; recovery401 followed a899s
server clock jump. Authentication assertions/TTL/timeouts were not weakened.
First artifacts: /private/tmp/capital-manual-first-artifacts; logcapital-manual-image-first.log.

Complete awake rerun session54938 FINISHED exit0, capital-manual-image-second.log:
85/85 Chromium,1worker,0retries,17.6m, plus all actual PG/migration/CLI/MFA/session/
expiry/providerTLS/artifact/27 invalidHTTPstartup prerequisites. All failed cases pass.
Backend sha256:9efd443953ddd723844aca23da46a9de6b016ffbc16b443ed65a933b3f35ce47.
Frontend sha256:cca53f6ade800efbb256f5164f37ebf4b4085190bde35253b44fe394ee0bf084.
Independent Docker checks confirm no owned Compose containers/networks/direct probes;
Nginx/lock hashes and file mode unchanged. No Docker run active at archive.
Hosted CI, second browser, image/SAST/DAST/fullASVS and backup/restore remain unrun.

## Active bounded change (backend verified, frontend in progress)

record-usd-fifo-trades: explicit attested empty origin, USD buys/sells/fees, exact
BigInt FIFO cumulative allocation, complete immutable corrections/terminal voids,
full-history validation and coherent revision-pinned reads. No opening-to-lot conversion.
Artifacts integrated and reconciled after manual archive. Maintained tests99b5789
observed two genuine real-MFA/HTTPS RED cases on the exact predecessor images:
initialization expected201/actual404 and absent protected Russian journal heading.
capital-usd-trades-red.log exit1; cleanup and prior rows/providers preserved.
Initial RED wrapper now uses mutable acceptance tags; do not repeat an old-image claim
without pinning predecessor digests. No fake unavailable-import RED was run.

Integrated pure helpers92e4c12, independent tests27c7ee5, PGfixturedfbef7a and backend
81587f2 (main ab73279). Root migration14 adds three tables, typed entities and module
wiring; shared fixtures/harness now expect14. No historical migration changed.
capital-usd-source-first.log exit0:196/4 suites including70 new arithmetic/parser tests.
capital-usd-migrations-first.log exit0: fresh14/replay/all unsafe refusals and populated
8/9/10/11/12/13 upgrades preserve rows/schema. First13-to14 log has old scenario label;
source corrected toTRADE-MIG-001 with unchanged assertions.
capital-usd-pg-first.log exit0: complete actual production-service/PG vectors, caps,
cross-process races, deferred-COMMIT rollback/retry and coherent RR/read-only reads;
retained manual-opening PG all pass. Backend image17283e22fdc410782a31ebdd86e627e8c07cb576fd1f0b82ffb9bc87e39fc2c3.
All three logs are in /private/tmp; owned Compose cleanup completed. Nginx/lock preserved.
Independent backend/schema review found no blocker. Full backend lint/build passed,
737/24 source tests and183/2 engineering tests passed, strict11 OpenSpec items passed:
/private/tmp/capital-usd-backend-baseline.log exit0. Reviewer identified a fixture gap:
same-chronology buy race does not isolate CAS or prove competing-sale overspend;
provider agent now adds distinct-order sale race in usd-trades-db-tests. Task3.5 pending.

Existing agents reused because platform thread limit prevents new spawn:
- audit_security owns frontend in usd-trades-frontend: API, journal/forms/results,
  minimal account detail/CSS integration; implement explicit ambiguity/receipt/draft guards.
- gate_acceptance owns expanded real HTTPS tests in usd-trades-acceptance, including
  financial UI, private boundaries, two-backend races and actual HTTP deferred rollback.
- provider_feasibility independently reviews backend/DDL and PG-fixture validity;
  owns only usd-trades-db.cjs for the additional independent race oracle.
Root owns integration, DDL/shared fixtures/evidence and all Docker; do not run Docker
from agents. Root UI plan /private/tmp/capital-usd-trades-frontend-plan.md independently
reviewed. All worktrees retained; never stage dependency symlinks. Read persistence.md.
Full source/image/Playwright verification, frontend review and archive remain pending.

Remaining full goal: CSV/carry-in/owned transfers/flows, performance/XIRR/TWR, DB-first
price/FX/history, sixchain adapters/reconciliation, optional explicitfree AI, immutable
promotion/security/backuprestore and final requirements audit; then consolidation.
