# Capital Tracker refactor continuity

## Goal and boundaries

Continue the incremental refactor against capital-tracker-openspec-prompt.md; the
full brief is NOT complete. Read AGENTS.md and the active OpenSpec artifacts.
Preserve owner data/unrelated edits. No paid services, remote push, owner database,
production deployment or original-folder removal. At the end of the WHOLE verified
refactor consolidate into capital-tracker-old under docs/consolidation-plan.md.

Branch refactor/brownfield-baseline. Root owns shared domain, migrations, lockfile,
deployment, shared fixtures and Docker. Worktrees remain retained. Explicitly choose
gpt-6-luna for future simple independent tasks; stronger models only for justified
complex implementation/security/review. Earlier continuation reused stronger agents
without a cheaper override; this was acknowledged to the user. Avoid redundant full
runs and large log output. Give short periodic Russian updates. Preferences saved.

Agent state: final security review by audit_security found no product/schema blocker;
two test-oracle gaps were strengthened and independently closed. New gpt-6-luna
carry_docs_review performed bounded read-only documentation review and confirmed all
five fixes. Both are completed. gate_acceptance remains usage-limited; never attribute
root-written expanded tests to it. All worktrees are retained, including detached
carry-in-release-review at46ce63f for stable review.

Preserve unstaged frontend/nginx.conf, mode0644/1348 bytes, SHA256:
115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432.
Lock SHA256: aa2588325aacdc54e8437d3500c7d2df580cc20cd061d1e3727f30f0dcc1e4f8.

## Runtime and supported workflow

Pins: Node22.21.1, pnpm10.33.0, OpenSpec1.2.0, Playwright1.63.0, PostgreSQL16.10.
Host Node22.21.1 was externally removed/global pnpm changed. Use existing wrapper:
PATH=/private/tmp/capital-task-bin:/Users/pavelars/.nvm/versions/node/v22.23.2/bin:$PATH
Host22.23.2 satisfies engines; image remains pinned. Do not change global tooling.

OpenSpec actual commands: new change, status/instructions --change NAME --json,
validate --all --strict --no-interactive, archive NAME --yes. No verify command or
validate --change. Skills propose/apply/archive were read. Set OPENSPEC_TELEMETRY=0.
Loop: specify/review -> real expected RED -> implement -> refactor -> independent
review -> verify -> archive. Pure refactors retain passing characterization. Never
weaken financial/security assertions, claim unrun checks or archive incomplete work.

Root alone operates synthetic capital-tracker-e2e with tests/e2e/compose.yml and
PostgreSQL tmpfs. Never production Compose or an owner DB. Docker escalations approved;
none rejected. Use caffeinate -is for long runs. Current active run is listed below.

## Verified predecessor

CSV archive83ce99d: openspec/changes/archive/2026-09-23-import-usd-trades-csv.
Source2ddfc58/product12e718c: full124/124 Chromium26.4m,1worker0retries,exit0;
all migrations15/PG/auth/artifact prerequisites passed. Canonical strict12 passed.
Full brief, hosted CI, other browsers, backup/restore and production remain unverified.

## Current carry-in slice

Read openspec/changes/archive/2026-09-23-seed-known-cost-carry-in/{proposal,design,persistence,specs,
tasks,verification}.md (actual individual paths). Known-cost current opening only;
explicit original Q/C/R, original cumulative allocation, immutable origin/baseline,
shared account lock and caller-owned RR reads. No inferred history or double holdings.
Old binaries cannot interpret carry-in origins; no mixed-version/binary rollback claim.
Migration16 is additive; no owner-data rewrite or destructive down. Amendments deferred.

Genuine exact-CSV-image RED at859e9b7 recordedcc186bc: missing API201/404 and missing
Russian heading, actual password/MFA/PG. Shared services/domain/migration/frontend
integrated by46ce63f. JSON102401-byte413 defect had actual unit/HTTPS500 RED and narrow
filter fix. Full backend902/28, frontend95/10, lint/build, strict E2ETSC, frozen install
and live production dependency audit passed (0 high/critical,2 existing moderate).
Existing77/29 lint and bundle warnings retained. Detailed commands/images/logs/reviews
are in verification.md; do not redo unchanged checks without cause.

Independent critical review confirmed source/schema/UI; strengthened other-account
CSV fingerprints and exact admission deltas at89846b3. Simple docs/count reviews
actually used gpt-6-luna. Product unchanged until the one-line note fix below.

Release attempts and actual outcomes:
-89846b3 full gate stopped before browsers on stale15 migration count. Three counts
 updated16 at524647f, independently reviewed without changed financial/security oracle.
-524647f full gate:132 passed/1 failed in28.8m,exit1; all prerequisites passed.
 OPEN-003-A got2 alerts instead of1: actual stale409 + persistent unknown-cost guidance.
 Log capital-carry-in-release-final.log; artifacts capital-carry-in-release-failed-artifacts.
 Earlier root updates missed the earlier failure by tailing latest tests; user corrected.
 Always scan COMPLETE passed/failed counts with /private/tmp/capital-release-progress.py.
-c20e465 fixes ONLY unknown-cost paragraph role=note + visible warning style; text/
 refusals/action alerts unchanged. CARRY-005-B and note/no-alert assertion added.
 Actual unchanged-image RED2/2 failures, then focused2/2 GREEN25.3s,exit0;
 logs capital-carry-in-note-{red,green}.log. Exact diff independently reviewed.
 Frontend lint/build95/10, E2ETSC and OpenSpec13 passed after fix.
-c20e465 next full gate hit CSV warm-cache restart after real Redis10-minute expiry.
 Deliberately interrupted ONLY owned Playwright, runner finally cleanup completed.
 Exit1:62passed/1failed/1interrupted/69unrun,14.6m; log capital-carry-in-release-verified.log;
 artifacts capital-carry-in-cache-failed-artifacts. Never claim this gate passed.

Now synthetic Compose alone explicitly sets supported EXCHANGE_RATES_CACHE_TTL86400000;
actual artifact check asserts both replica environments. Exact provider expectations
unchanged:2 constructor calls/zero accounting calls. Production default unchanged.
Independent review approved fixture determinism, no expiry coverage claim. Exact-image
focused CSV case passed1/1 in18.4s,exit0, capital-carry-in-cache-focused.log.
All logs/artifact folders above are under /private/tmp. Owner hashes unchanged.
Current images:
backend sha256:36856553e640b6906894d3e70dc8122548b31e7b84a699777344699e008da315
frontend sha256:f81445af15fe1c9f48c39ee13118bbdd0e00c8060d91676a72fcbed8f1868c0a

COMPLETE: full gate at59863bf passed133/133 Chromium28.9m,1worker0retries,
terminal exit0, /private/tmp/capital-carry-in-release-complete.log. All prerequisite
PG/migration/auth/artifact checks passed. Independent cleanup inventories empty;
owner Nginx and lock hashes match. No active synthetic run or containers remain.
Supported openspec archive seed-known-cost-carry-in --yes succeeded2026-09-23:
6new and10modified requirements, zero removals; predecessor scenarios retained.
Canonical purpose and archive links updated. No new product changes after c20e465;
59863bf is synthetic fixture determinism. Never consolidate incomplete work.

## Next slice prepared independently, not implemented

Worktree capital-tracker-worktrees/historical-accounting-design, branch
refactor/historical-accounting-design. New inspect-historical-accounting proposal/
design/4requirements/15tasks e65529a; pure/query test oracles6390ac8; independent
initial API/UI tests0a6efa2; root HTTP privacy tests a7e1471; independent PG probe
82a8baa with root review ee07ba6; late-response/correction browser case153d979,
root all-accounting-POST guard and strict E2ETSC review a639c25. Worktree HEADa639c25.
All changes isolated from active release.
Cheap agent gpt-6-luna authored/reviewed bounded tasks; root caught and corrected
missing trade fingerprints, UI CSRF bookkeeping and a quantity2 expected-value bug.
Strict E2ETSC/scoped Biome/PG syntax passed, no historical runtime or product code yet.
Temporary dependency symlinks were removed; main dependencies unchanged.
Future interface: HistoricalAccountingService(source).getSnapshot(owner,account,raw).
Pure interfaces: projectHistoricalAccounting(heads,baseline,at), parseHistoricalQuery.
Do not integrate or run next-feature RED before carry-in is verified/archived. Then
reconcile canonical specs, integrate prepared commits, run exact carry-in-image missing
API/UI RED without rebuild, implement incrementally. PG100+1000 bound, account-switch and pinned409
UI cases still need coverage. All prepared browser/PG/pure cases remain unexecuted. Full target remains substantially unfinished.
