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
Lock SHA256 aa2588325aacdc54e8437d3500c7d2df580cc20cd061d1e3727f30f0dcc1e4f8.

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

## Latest manual period profit slice

preview-period-profit implemented, independently reviewed and verified with scoped checks;
archived 2026-09-23-preview-period-profit; all 11 tasks complete. Canonical strict
validation passes 16/16; active changes empty. All preceding 15 specs unchanged. Productsourcec4ae371, backend43681aa. Guide
docs/period-profit-preview.md; evidence openspec/changes/archive/2026-09-23-preview-period-profit/verification.md.
POST /accounting/portfolio/profit-preview (200), bodystrictfrom/to/nonnegativeexact
openingValueUsd/closingValueUsd/assertReviewedtrue; noownerinput. Completecurrent
ownerflows inoneRRREADONLY snapshot; missing/beforecoverage409, invalid400.
Exactprofit=closing-opening-contributions+withdrawals; same[from,to)boundary.
Manualvaluationsbeforeflowsateachboundary, unreconciledflowstatusandrevision.
No persistence/migration/deps/providers/rates. Russian /period-profit page,
reviewresetonedit, noautopost/storage, late/errorresponsescan'trestoreoldresult.

RootBE/pure/PG; Luna2browsercases+docsreview inprofit-acceptance worktree;
SolUIinprofit-ui, independentlyreviewedrootbackendnoblocker. RootreviewedUI,
addedaccessibleboundaryhelp/copy;badtestoraclesfixedwithoutweakeningassertions.
GenuinepredecessorRED2/2(200vs404/missingheading), beforenewproduct. Log
/private/tmp/capital-profit-predecessor-red.log, exit1, originalflowimagesverified.
Pure111/3(54new+57retained)pass, BEbuild/lint77existingwarnings. UI95/10existing
unitspassedbySol; finalmainFE TS/build/lint29existingwarnings+bundlewarningpass.
RealPG4profitfamilies(coverage,61effectiveflowssnapshot/foreign/readonly,
actualtwo-connectionRRbarrier,1000maximumamounts)+8retainedflowfamiliespass;
/private/tmp/capital-profit-db-focused.log,exit0. No fullmigrationmatrixrepeat.
FinalHTTPS3/3in36.8s,1worker0retries:2profit+retainedFLOW-004-A, actualMFA/HTTPS/PG;
/private/tmp/capital-profit-focused.log exit0. No full146suite/fullBEunitclaim.
Backendsha256:24a9827a93bae8615bc84feb90f6351f3730e6d4ed77319f459e07b524cdacfb
Frontendsha256:1a5a83094e97866982fb28e84038286c5b74264565a1eca745759e6e61e2c6be
OwnerNginx/lock/modepreserved;syntheticcontainers/networksempty. NoownerDB/prod.
NewrealPGfixturewiredintoexistingfullrunner. All prior tests retained.

Allworktreesretained includingprofit-acceptance/profit-ui siblings. Agenttemporary
dependencysymlinksremoved. Reusecarry_docs_reviewLuna(simple) /historical_uiSol
(complex/review);gate_acceptancequota-limiteduntilSep29(donotretry/purchase).
Next whole-brief work: persisted/automatic valuations, XIRR/TWR, transfers/swaps/
rewards, DBprices/history/charts, blockchains/reconciliation, optionalAI,
releasehardening/backuprestore/consolidation. Profitpreviewisoneboundedmanualstep,
not wholeperformancecompletion. Selectnextsmallcontract; don'tmove/deleteoriginals.
