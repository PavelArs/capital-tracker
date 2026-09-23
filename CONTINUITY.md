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

## Latest external USD flow slice

Completed/archived record-external-usd-flows on2026-09-23 aftertargetedGREEN.
See openspec/changes/archive/2026-09-23-record-external-usd-flows/verification.md.
Supportedarchive synchronized5new/1modified/0removedrequirements; all14tasksdone,
canonicalstrict15/15pass andopenspec listempty. Allpreviousscenarioheadingsretained.
Backend37980b5; finalproductfixea7cceb. Explicit owner-reviewed contributions/
withdrawals only, exactscale30 [from,to), immutablecorrection/terminalvoid/receipts,
ownerjournal locking/CAS/RR. Separatefromholdings/trades/returns, unreconciledcoverage.
Migration17 adds onlyportfolio_flow_journals/portfolio_flow_versions. No dependencies.
Root backend/puretest/migration; Luna initialAPI/UI/privacy/docs; SolPG andcomplexUI/
recovery. Independent Sol rootbackendreviewatbb5f941 foundnoblocker. RootUIreview
found mixedoldhistory/newflowID; genuine delayedrealresponseRED then2linefixea7cceb;
independentSolclosure andactualGREEN.

Genuine predecessorRED at49d6d99: init201vs404/missingRussianheading,exit1; log
/private/tmp/capital-flow-predecessor-red.log. Initialpostimplementationfailedruns
had incorrectfixtureisolation/error-envelope/selectlocator oracles, corrected
without changingproduct/weakeningfinancialassertions. Detailedresults inverification.
New flow-only testfixture guardedexactsyntheticDB/user clears ONLYtwoflowtables
betweenindependentcases, nevermidjourney; neededowneroriginnotperaccountscope.

Verified: backend996/32units; frontend95/10existingunits; builds,lint77/29existing
warnings,strictE2ETSC,frozeninstall,audit0high/critical(2existingmoderateRouter).
ActualPG eightflowfamilies inclprocessraces/lockwait/deferredCOMMITrollback/RR/maxcaps/
SQLconstraints; fullfresh17/replay/upgrades8..16/unsafelegacyrefusals andretained
historicalPG. Logcapital-flow-migrations-focused.log,exit0.
SixdistincttargetedHTTPS: API/privacy passunchangedbackend inpartialrerun; final
UI/recovery+retainedhistoricalUI/carryCSV passed4/4in53.4s,exit0 at ea7cceb. No144
fullbrowserclaim. Logs /private/tmp/capital-flow-{focused-rerun,final-focused}.log.
Finalbackendsha256:b8a8f25490603eeaaad904b2d762cd188045cd81c45b97c813d7c72c14066f28
Finalfrontendsha256:d169e6d8d0ef9d96fba34dfa3dcaa4d9799832bc4991f75b53fee811124c571c
Containers/networksindependentlyempty; hashes/modeunchanged. NoownerDB/production.

Allworktreesretained includingflow-acceptance,flow-postgres,flow-ui. Temporary
dependencysymlinksremoved byagents. carry_docs_reviewLuna finaldocscheckcomplete;
historical_uiSol complete; gate_acceptance quota-limited untilSep29(donotretry/purchase).

Next whole-brief work: periodvaluations/profit/XIRR/TWR, transfers/swaps/rewards,
DBprices/history/charts, blockchains/reconciliation, optionalAI,releasehardening/
backuprestore/consolidation. Selectanotherboundedcontract and genuineATDDslice.
Do notmove/deleteoriginalor duplicateprojectfoldersyet.
