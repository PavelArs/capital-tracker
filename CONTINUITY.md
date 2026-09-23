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

Twelve archived slices cover baseline/release harness, CLI owner, opaque sessions,
mandatory MFA, preserved checkout, dependencies, source trust, auth limits, exact
openings, USD FIFO trades and reviewed CSV import. Full evidence is in each archive.
Latest archive83ce99d: openspec/changes/archive/2026-09-23-import-usd-trades-csv.
Actual source2ddfc58/product12e718c full gate:124/124 Chromium in26.4m,1worker0retries,
exit0 plus migrations15/PG/auth/artifact/topology. Log capital-csv-release-full.log
under /private/tmp. Canonical strict12 passed. No production release claim.
Exact CSV predecessor images retained as historical evidence:
backend sha256:0c239e1e9b2994bd5468bc50ea9ededccf619b44022caf29e84999c18be99e46
frontend sha256:e973022048dc5f18608e381d93bcb7a49753efc0653ef37eb04c97164f4fdb4f
Last dependency gate had0 high/critical,2 moderate Router findings; not refreshed
for the active slice. Hosted CI, second browser and backup/restore remain unrun.

## Active seed-known-cost-carry-in

Read proposal/design/persistence/spec deltas/tasks/verification in its change folder.
Known-cost current opening only; explicit original Q/C/R; exact original cumulative
allocation offsets; no invented historical trades or double holdings. Shared owned
account lock, replay before mutable checks, caller-owned RR baseline reads, explicit
carry-in provenance. Baseline amendment remains required later work. Old binaries
cannot interpret new carry-in origins: no mixed-version or safe rollback claim.

Actual predecessor RED at859e9b7, recordedcc186bc: exact CSV images/no rebuild,
real password/MFA/opening/PostgreSQL; expected201/actual404 and missing Russian
heading. Log /private/tmp/capital-carry-in-predecessor-red.log, preserved RED artifacts.

Integrated independent components: pure tests5eaae87, services36c6ed6, root shared
7175f50, PG1188947/96f4d2b, frontend e31a0d8. Audit reviewed shared domain, migration16,
entities and frontend without blockers. Root subsequently added migration fixtures,
expanded browser tests and the JSON413 fix; final independent review is now complete.
Review-driven changes only strengthen tests and correct documentation.

Migration16/entities and populated15 fixture are implemented. Fresh16/replay/all
populated8..15/unsafe legacy refusals passed. Opening, USD, CSV and8 carry-in PG
families passed across runs. Logs /private/tmp/capital-carry-in-pg-{first,second,third}.log;
third exit0. Initial fixture repairs only changed stale migration15 count and allowed
ONLY the new journal.openingRevision nullable integer; all old columns/rows retained.
PG backend image: sha256:ce10d4b64c06b11e3f4f71294f7ae3bf3c9d286f0dc684be3081d342f54e0186.

Original2 real HTTPS tests passed31.2s. Expanded tests cover actual401/MFA/SPA replay,
route/CSRF privacy, stale and late consent, literal labels/unknown costs, accepted
receipt/read loss, manual/CSV250/100/correction230/rollback/bytes, deferred HTTP COMMIT.
Their intermediate fixture errors are recorded honestly in verification.md.

Genuine JSON defect:102401-byte body expected413/actual500 via real HTTPS. Added
CARRY-006-B boundary/privacy scenario and unit RED. Narrow Error/type/status filter
fix preserves private generic500 for unrelated errors.39/39 admission tests passed.
Full backend902/28 passed11.333s; lint passed, strict OpenSpec13 passed. Logs:
/private/tmp/capital-carry-in-{json-unit-red,json-unit-green,backend-final-tests,
backend-final-lint,spec-final,e2e-tsc-final}.log (individual filenames, no literal braces).
New backend build passed, image:
sha256:60d3225df079dd372d698846b63dfc3ea15244d3fd446c33538afa2a1c6dd1e4.

NOW: all9 carry-in Playwright cases completed exit0 in2.0m,1worker0retries,
/private/tmp/capital-carry-in-http-integrated.log. Exact backend digest above; frontend
sha256:c4a616a5391df772b6a5f8ad5f3f8e2f6e2713b7dc4b260f86a9811004d7f55c.
No Docker run is active. Independent inventory found no synthetic containers/networks;
owner Nginx/lock hashes unchanged. E2E strict TypeScript exit0. Preserve this evidence.

READY: focused stronger2 passed25.9s, /private/tmp/capital-carry-in-review-focused.log,
strict E2E TypeScript passed. Frozen install/live audit/frontend lint/build95/10 passed;
0 high/critical,2 existing moderate Router findings, unchanged77/29 lint warnings and
629.42kB bundle warning. See active verification for actual commands/results/reviews.
No new product code since46ce63f; previously recorded902/28 backend checks remain valid.

Full release attempt89846b3 stopped before browsers at stale15-count auth-limit
fixture; all migration16/upgrades/refusals passed first. Log capital-carry-in-release-full.log.
Three prerequisite counts (auth-limits DB, startup state/show) updated16; independent
cheap-model review confirms no other oracle changed. This is not behaviorRED.

Full release524647f finished exit1:132 passed/1 failed in28.8m,1worker0retries.
Log /private/tmp/capital-carry-in-release-final.log; failure artifacts preserved in
/private/tmp/capital-carry-in-release-failed-artifacts. All DB/CLI/startup/artifact
prerequisites passed. OPEN-003-A manual-opening.spec.ts:301 expected one alert after
real409 but saw opening conflict + persistent unknown-cost CarryIn alert. Root's
intermediate no-failure updates missed the earlier failure in tailed logs; corrected
explicitly to user. Always scan complete summaries, not only latest test indexes.
Cleanup independently empty; owner Nginx/lock hashes unchanged.

Reviewed fix: unknown-cost eligibility guidance becomes a visible role=note with
warning styling; preserve text/refusals and actual conflict/recovery alerts. Cheap
independent review supports this semantic correction. CARRY-005-B and a strict note/
no-duplicate-alert assertion added before product changes. Existing opening test is
unchanged. Actual unchanged-image RED finished exit1 with both intended failures:
/private/tmp/capital-carry-in-note-red.log, runner capital-carry-in-note-red.cjs.
Backend sha256:36856553e640b6906894d3e70dc8122548b31e7b84a699777344699e008da315;
frontend sha256:c4a616a5391df772b6a5f8ad5f3f8e2f6e2713b7dc4b260f86a9811004d7f55c.
One product line changed unknown-cost to visible role=note; exact diff independently
reviewed without blocker. Focused GREEN finished exit0,2/2 in25.3s; log
/private/tmp/capital-carry-in-note-green.log. Frontend image now
sha256:f81445af15fe1c9f48c39ee13118bbdd0e00c8060d91676a72fcbed8f1868c0a.
Frontend lint/build95/10, E2E TypeScript, OpenSpec13 passed. Cleanup independently
empty, owner Nginx/lock hashes unchanged. NEXT: full release rerun, still no archive.

Next slice preparation is isolated in worktree historical-accounting-design, branch
refactor/historical-accounting-design: e65529a reviewed OpenSpec proposal/design/
4 requirements/15 tasks,6390ac8 root pure/query test oracles,0a6efa2 independent
gpt-6-luna two initial real HTTPS/browser tests. No product implementation/RED yet.
Dependency is verified carry-in archival. Do not integrate/run it prematurely.
Full brief remains unfinished. Never deploy or consolidate incomplete work.
