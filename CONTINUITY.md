# Capital Tracker refactor continuity

## Goal and limits

Continue incremental refactor against capital-tracker-openspec-prompt.md. The WHOLE
brief is substantially incomplete. Read AGENTS.md, Git diff and current OpenSpec.
No paid services, production/owner DB, remote push or folder deletion. Consolidate
into capital-tracker-old only after whole verified refactor, under
docs/consolidation-plan.md. Original projects and owner data remain untouched.

Main branch refactor/brownfield-baseline; root owns migration/dependency/deployment/
shared runners and Docker. Use isolated worktrees, Luna for bounded simple work and
Sol/stronger for complex code, concurrency/security/independent review. Keep short
periodic Russian updates and clean compatible code. Preferences persisted.
Use targeted checks by default per user2026-09-23; no full E2E per slice. Existing
CI gates retained. Review test pyramid separately before removing redundant cases.

Preserved unstaged frontend/nginx.conf: mode0644,size1348, SHA256
115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432.
Lock SHA2566a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d
(XIRR adds exact backend decimal.js10.6.0). No dependency change in valuation slice.

## Tooling and workflow

Pins Node22.21.1,pnpm10.33.0,OpenSpec1.2.0,Playwright1.63.0,PG16.10.
Host pinned Node was externally removed; use existing wrapper without global edits:
PATH=/private/tmp/capital-task-bin:/Users/pavelars/.nvm/versions/node/v22.23.2/bin:$PATH
Image Node remains pinned. Frozen installs need usual pnpmstore escalation, not
node_modules deletion. Respect frontend/backend own Biome config, not root defaults.

Supported OpenSpec new change/status/instructions/validate/archive; no verify command.
Set OPENSPEC_TELEMETRY=0. Specify/review -> genuine real RED -> implement/refactor ->
independent review -> targeted verify -> archive. Pure refactors retain passing
characterization. Never weaken financial/security oracles or claim partial/full
runs passed. Root exclusively operates tests/e2e/compose.yml, capital-tracker-e2e,
PGtmpfs. Use caffeinate -is for long runs. Never production Compose. No active test
containers/networks remain after latest cleanup (live labeled inventory empty).

## Completed foundations

Historical accounting, external flows, manual profit and conventional XIRR archived
under openspec/changes/archive/2026-09-23-*. Earlier full133 suite passed at carry-in;
historical full140 attempt was stopped per user, never GREEN. Manual profit/XIRR
still use reviewed manual endpoint valuations and effective owner flows.

record-manual-usd-prices archive40b473b added schema18/manual_usd_price_versions:
owner/instrument UUID, exact48int/30frac USD unit strings, UTCms1970..9999, immutable
set/void/restore,10000version cap, serialized CAS/idempotent replay, RR history.
Guide docs/manual-usd-prices.md and its archived verification contain the actual
488unit, PG migration/race/preservation and3HTTPS+1focused recovery results.
No provider ingestion, symbol mapping, interpolation or automatic full portfolio
value. All existing price/accounting contracts remain unchanged by valuation.

## Current historical valuation slice

value-historical-account implemented, independently reviewed and targeted GREEN;
archived2026-09-23-value-historical-account with7/7tasks. Contract660c6ce,
acceptancebaf0304/e57d5fb/c208044, backend4edac35, UI9bc3209, finalb90e65e.
Read archived change design/tasks/verification; guide docs/historical-valuation.md.
Strict19canonical specs pass, active changes empty;18 prior specs unchanged.

GET /accounting/accounts/:id/valuation?at=ISO accepts only at; own account historical
positions and exact-time manual prices in one RR READ ONLY snapshot. Shared
historical-accounting.store.ts retains old history API/paging. BigInt product/sum
scale60, full bounded set <=1100positions. Same-symbol UUIDs never merge. Missing or
voided exact point => null row value/total and explicitly partial priced subtotal;
price0 remains known, empty covered holdings complete0, absent/precoverage409.
Current-effective-history basis and per-point revision explicit. No cash inference,
whole-portfolio aggregation, performance integration, providers or migration.

TradeJournal hosts independent Russian HistoricalValuation section using actual
journal revision for invalidation; generation guards clear late/input/account/
revision/unmount results. Exact rows, manual caveat, explicitrefresh, parentdraft
preserved. Sol UI in valuation-ui worktree; Luna 2E2E in valuation-acceptance.
Sol independently reviewed backend; root reviewed UI and improved wide amount
wrapping/exact price span; Luna docs/test review. Worktrees preserved, temporary
agent node_modules symlinks removed.

Actual predecessor RED: anonymous expected401 got404; missing valuation heading
10s.2failed exit1 against previous accepted manual-price images before product
edits. /private/tmp/capital-valuation-red.log and red-artifacts retained.

123unit/4suites (31new+92retained),1.944s; backend build/lint pass77existingwarnings;
main frontend build/lint pass29existingwarnings and retained >500kB warning;
Sol95existingVitest pass. E2E strict/noUnused TS pass. Production auditexit0 with
2existingmoderate findings, lock unchanged; /private/tmp/capital-valuation-audit.log.

Actual PG at4edac35: fourvaluationfamilies exact/gaps/coverage/privacy/real separate
connection RR/scale60/max100baseline+1000trades, all-row preservation; retained
historical-accounting-db.cjs also passed. Each fresh synthetic DB uses18actual
migrations. /private/tmp/capital-valuation-db.log exit0.

Actual HTTPS atb90e65e:3/3 in37.8s,1worker0retries (VAL-API,VAL-UI,retained HIST-004-A).
Real password/MFA/backend/PG; only external providers stubbed, delayed response
uses actualroute.fetch. /private/tmp/capital-valuation-green.log and green-artifacts.
Images: BEsha256:6585ed74167fb470aa4c5575e934759daf14f60adb2502b1ed0a84f3409b8fd4
FEsha256:f034307171dc39856cd16fe5bfe5ca177998584419324b90c9375de6279db4ea.
Backend image identical between PG and HTTPS. Artifact/network checks pass.
No unexpected GREEN failures. No full backend/full E2E/upgrade matrix/hostedCI/
release scan/production run this slice. Old cases and CI gates preserved.

## Next

Choose the next small database-first historical coverage/chart slice using this
account valuation foundation. Whole brief
still needs automatic prices/history/charts, multi-account valuation, TWR, transfers/
swaps/rewards, blockchain reconciliation, optionalAI and release/backup-restore
hardening before consolidation. Do not move/delete original folders now.
Reuse carry_docs_review Luna(simple) and historical_ui Sol(complex/review).
gate_acceptance quota-limited untilSep29; do not retry/purchase.
