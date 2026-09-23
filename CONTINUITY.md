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

Agent state: carry-in critical review was completed by audit_security; historical
backend independently reviewed by historical_ui (explicit gpt-6-sol), with one
saved-history error finding reproduced/fixed/closed. Root reviewed its frontend.
carry_docs_review (explicit gpt-6-luna) authored browser boundaries and reviewed docs/
targeted selection. All worktrees retained. gate_acceptance remains usage-limited;
never attribute root-written tests to it. No active worker owns main product files.

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

## Verified carry-in predecessor

Archive1667502: openspec/changes/archive/2026-09-23-seed-known-cost-carry-in.
Source59863bf/productc20e465 full133/133 Chromium28.9m,1worker0retries,exit0;
all migration16/PG/auth/artifact prerequisites passed; canonical strict13 passed.
Its verification records genuine RED, earlier failed gates, the one-line guidance
role correction and deterministic synthetic warm-cache lifetime. No failed run is
release evidence. All old scenarios retained; archive6new/10modified/0removed.
No owner DB, production deployment, paid service, folder deletion or remote push.

## Verified historical-accounting slice

Read openspec/changes/archive/2026-09-23-inspect-historical-accounting/{proposal,design,specs,tasks,
verification}.md and docs/historical-accounting.md. Current-effective restated
per-account positions/cumulative FIFO at explicit instant, not past knowledge,
observed balances, prices or investment returns. No migration/dependency/provider.
One caller-owned readonly REPEATABLE READ; complete-prefix calculation before UUID
aggregation/paging, immutable original baseline, strict query/pinned revision.
Russian view preserves parent drafts, invalidates input/account/observed-revision
changes and ignores late responses. Real409 clears pages and needs explicit refresh.

Prepared design/test commits integrated11b18f1 only after carry-in archival. Genuine
exact-predecessor RED:2failures API200/404 and missing Russian heading, real HTTPS/
MFA/PG. Log /private/tmp/capital-historical-predecessor-red.log, synthetic artifacts
capital-historical-red-artifacts. Root backend85c7581; independent Sol frontend
b104603/14e6fbc integratedf5e88fd/42b6805. New mocked-API component tests removed;
all oldfrontend tests retained and real browser coverage added instead.

Independent Sol backend review found saved-history400/500vs409 classification gap.
Real PostgreSQL RED against unchangedbb9e33image: expected409/non-HTTPerror;
capital-historical-invalid-confirmed-red.log exit1. Narrow typed validation fix
ab48ba0; independent exact-diff closure, actual PGGREEN including full bounds.
Arbitrary SQL/programming errors remain500, caller input400, old callers unchanged.
Luna independently authored/reviewed browser boundaries and docs. Root corrected
fixture chronology and arithmetic before runtime; merged11ac0dc. Full traceability
and all prior intermediate findings/results are in verification.md.

Source checks after correction: backend939/30, frontend95/10, lint/build exit0;
77/29existingwarnings and bundlewarning. Frozeninstall and live high/critical audit
exit0 (2existingmoderateRouter findings). StrictE2ETSC and OpenSpec14/14 exit0.
Five realPG families passed, including readonlyRR process barrier, foreign/coverage/
zero/stale pages,100baseline+1000max-precision trades and invalidsaved409.
Focused7/7 HTTPS Chromium1.4m,1worker0retries,terminalexit0 atc8873bb, exactimages:
backend sha256:1f6ce77cba5ad9444ccb8d3a6ba769fc722560bf9145401651f418054a33388f
frontend sha256:acf24293ebd64f3cbc9425c7e86504402c55109a849a9ac0f46630e7b1d2cc95
Log /private/tmp/capital-historical-focused.log; independent cleanupempty andhashes
unchanged. Seven cases cover timeline/carryboundary/privacy/literalHTML/lateinput/
accountswitch/realpinned409+successfulpage/observedrevision and parentcorrection.

USER POLICY UPDATE2026-09-23: default to targeted verification, not fullE2E for every
change; later review E2Epyramid and move appropriate coverage down before deleting
redundantcases. AGENTS/config/testingguide updated. Existingtests/CIGates intact.
Full b7bf7fc run deliberately stopped perowner duringclient-source-startup, before
Chromium, exit1; all migration/old+newPG/CLI/session/MFAfamilies hadpassed first.
Log /private/tmp/capital-historical-release.log. Do notclaimfull140GREEN.
Additional exact-image retained CARRY001A+004A criticaltests passed2/2in33.2s exit0,
capital-historical-critical-regression.log. New7+retained2=9targetedcases; all5PG
families and sourcechecks passed. Independently confirmedcleanupempty, hashesmatch.
NoactiveDocker/run remains. Productimagesunchangedafterc8873bb.
DONE: supportedOpenSpecarchive inspect-historical-accounting --yes succeeded,
4newcanonicalrequirements and0previousrequirementschanged/removed; strict14/14
passed. Noactivechange
remains in main after archival. Targetedverification scope isexplicitabove.
Fulltarget still substantiallyunfinished: price/history/providerreconciliation,
cashflows/transfers/swaps/rewards/performance,AI,releasehardening/consolidation.
Nextsmallengineeringtask: review E2Ecriticaljourneys/duplicatedpermutations and plan
coveragepreserving moves tolowerlevels; userasked thislater, no testsdeletednow.
Do notmove/delete originalor duplicatefoldersbefore WHOLEverifiedrefactor.

Retained worktrees: historical-accounting-design HEADa639c25 (prepared commitsnow
integrated), historical-ui HEAD14e6fbc (integrated), historical-browser-boundaries
HEAD6fa53f6 (integrated), plus priorworktrees. Temporarydependency symlinksremoved.
No active agent should mutate main duringgate; gate_acceptance isusage-limited.

## Active external USD flows

Active change record-external-usd-flows; artifacts28353e8, initial acceptance49d6d99.
Frozen design separates explicit owner-reviewed USD contributions/withdrawals from
trades/holdings/returns, exact scale30/[from,to), immutable correction/void/replay,
owner journal lock and RR reads. Additive migration17 owned by root.
Actual predecessor two-case RED confirmed:201vs404 and missing Russian heading,
exit1; capital-flow-predecessor-red.log; exact historical images above. Resources
cleaned and owner hashes unchanged. No new product implementation yet.
Sol PG probe68cb060 pending root review/integration; Luna authors single privacy
case in flow-acceptance; flow-ui worktree created for independent complex frontend.
Root owns backend/migration/shared runner; targeted manifest in verification.md.
Do not run full E2E by default. Whole brief/consolidation still incomplete.
