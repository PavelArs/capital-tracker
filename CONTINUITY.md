# Capital Tracker refactor continuity

## Goal and limits

Continue incremental refactor against capital-tracker-openspec-prompt.md. The WHOLE
brief is substantially incomplete. Read AGENTS.md, Git diff and current OpenSpec.
No paid services, production/owner DB, remote push or folder deletion. Consolidate
into capital-tracker-old only after whole verified refactor, under
docs/consolidation-plan.md. Original projects and owner data remain untouched.

Main branch refactor/brownfield-baseline; root owns migration/dependency/deployment/
shared runners and Docker. Use isolated worktrees, Luna for bounded simple work and
Sol/stronger only for complex code, concurrency/security/independent review. Keep
short periodic Russian updates and clean compatible code. Preferences persisted.
Use targeted tests by default per user2026-09-23; no fullE2E per slice. Existing
CI gates retained. Later review test pyramid before moving/removing redundant cases.

Preserved unstaged frontend/nginx.conf: mode0644,size1348, SHA256
115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432.
Lock SHA256 6a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d
(XIRR adds exact backend decimal.js10.6.0; existing resolutions unchanged).

## Tooling and workflow

Pins Node22.21.1,pnpm10.33.0,OpenSpec1.2.0,Playwright1.63.0,PG16.10.
Host pinned Node was externally removed; use existing wrapper withoutglobalchanges:
PATH=/private/tmp/capital-task-bin:/Users/pavelars/.nvm/versions/node/v22.23.2/bin:$PATH
Image Node remains pinned. Frozen installs need usualpnpmstore escalation, not
node_modules deletion. Respect frontend/backend own Biome config, not rootdefaults.

Supported OpenSpec new change/status/instructions/validate/archive; no verify command.
Set OPENSPEC_TELEMETRY=0. Specify/review -> genuine realRED ->implement/refactor ->
independent review ->targetedverify ->archive. Pure refactors retain passing tests.
Never weaken correct financial assertions or claim failed/partial/full runs passed.
Root exclusively operates tests/e2e/compose.yml projectcapital-tracker-e2e, PGtmpfs.
Use caffeinate -is forlongruns. Never productionCompose. NoactiveDocker/run now.

## Verified preceding slices

Carry-in archived1667502: 133/133 fullChromium28.9m plus allmigration16/PG/auth gates.
Historical archivedf69c059: sourcec8873bb, fivePGfamilies and9targetedHTTPS; full140
run deliberately stopped peruser beforeChromium,exit1, neverclaimfullGREEN. See
openspec/changes/archive/2026-09-23-{seed-known-cost-carry-in,inspect-historical-accounting}/verification.md.

External flows archivedd6305e1: canonical external-usd-flows spec, immutable reviewed
USD origin/contributions/withdrawals/corrections/voids, exactscale30 [from,to),
owner locking/CAS/RR. Migration17 iscurrent. 996backend/95frontendunits;8PGfamilies,
fresh17/populated16upgrades;6targetedHTTPS. Prior144fullsuiteNOT run. See
openspec/changes/archive/2026-09-23-record-external-usd-flows/verification.md.

## Preceding manual period profit

Archived dfa1f64 at 2026-09-23-preview-period-profit; productsource c4ae371.
Canonical period-profit-preview; exact closing-opening-contributions+withdrawals
from reviewed manual values and complete owner flows in one RR READ ONLY snapshot.
Strict body, nonnegative exact strings, [from,to), 409 outside journal coverage.
No persistence/provider. Russian /period-profit page with review/stale-result guards.
111 pure cases, four PG families plus eight retained flow families, three HTTPS
cases passed. Full146 E2E was NOT run. Detailed evidence is in its archive.

## Current conventional XIRR slice

preview-conventional-xirr implemented/reviewed/scoped GREEN; archive pending.
Source dae9260, backend f820e25, UI1fd4d2c, testcounter/benchmark a784593.
Guide docs/xirr-preview.md; current evidence
openspec/changes/preview-conventional-xirr/verification.md.
POST /accounting/portfolio/xirr-preview reuses the reviewed manual body and adds
xirr to the same-snapshot profit payload; old profit response unchanged. Negative
opening/contributions, positive withdrawals/terminal, exact UTC-ms aggregation,
ACT/365F. Only negative-then-positive patterns, 2..64 nonzero instants, inclusive
rate[-0.999999,1000], tolerance1e-10, 12-decimal rate and exact100x publishedpercent.
Unavailable has null rates and specific reason. Decimal96 precision, bounded80
iterations/yields, one active request per process with429, finally release.
DB snapshot is committed/released before solver. No migration/provider/writes.
UI explicit XIRR action, same review/generation guard, approximate/manual/
unreconciled labels, ACT/365F/bounds/datecap, short actual-horizon warning.

Root backend/pure/PG; Luna browser acceptance/docs in xirr-acceptance worktree;
Sol UI in xirr-ui and independent backend numerical/snapshot review (no blocker).
Root reviewed UI/oracles. Genuine predecessor APIRED200vs404, clean UIREDmissing
button; logs /private/tmp/capital-xirr-{predecessor-red,ui-red}.log. Initial UI
wait also expired a quota row: not counted as clean RED; direct assertion rerun.

139 pure cases/4 suites (28new+111retained),2.693s; BEbuild/lint77existingwarnings.
MainFEbuild/lint29existingwarnings+bundlewarning, scopedE2ETS pass; Sol ran existing
95frontendunits/10files. Frozen install and requiredproductionaudit exit0, fullJSON
exit1:2existingmoderateRouter,0high/critical/low,331proddeps. docs/dependency-security.md.
PG16.10/fresh17migrations:3XIRR+4retainedprofit families pass; actual two-pool
snapshot/correction/429/read-only/all-row checks and real solver-entry observation.
Initial PG test expected >=6 solver entries but has5successfulcalls; fixed to
exactly5, financial assertions unchanged; final exit0. Logs
/private/tmp/capital-xirr-db-{initial-failed,focused}.log (actual initial log is
/private/tmp/capital-xirr-db-initial-failed.log; final capital-xirr-db-focused.log).
64date1970..9999 benchmark in pinnedNode22.21.1image:4564ms,506timerticks, no SLA.

HTTPS4/4 in47.4s,1worker0retries:2XIRR+2retainedprofit, actualMFA/HTTPS/PG.
/private/tmp/capital-xirr-focused.log exit0. Source dae9260; images:
BEsha256:ab4db35ed693eb1dfc70541d9d3a17d86d45b57ef531fde7966ca0dd04092505
FEsha256:953f485238c2e57cef42f69f385633823c0936a3c880f5424e7e38374fbc5043
Owner Nginx mode/hash preserved; synthetic containers/networks empty. Nofullunit/
fullE2E/upgrade matrix/release scans/hostedCI/production claim. Existing CI gates
and cases retained; xirr-preview-db.cjs added to existing full runner.

All worktrees retained, including xirr-acceptance/xirr-ui. Agent dependency symlinks
removed. Reuse carry_docs_review Luna(simple), historical_ui Sol(complex/review);
gate_acceptance quota-limited untilSep29: do not retry/purchase.
Next after archive: select a small persisted/automatic valuation or DBprice/history
contract. Whole brief still needs TWR, transfers/swaps/rewards, DBprices/history/
charts, blockchains/reconciliation, optionalAI, releasehardening/backuprestore/
consolidation. Conventional manual XIRR is partial support; do not move/delete
original projects before the whole verified refactor and consolidation preflight.
