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

## Completed chart slice

chart-account-valuations contract5a3e367, backend pure3496b13, PGcb53d1c,
E2Ed9a144b/root-reviewed302b235. Actual predecessor behavioral RED:401 expected vs404
and absent history heading. /private/tmp/capital-chart-red.log and red-artifacts.
Only after RED, root implemented backend9f70991; Sol UI42081e2/5fdc42c integrated as
7b07051/2935162. Root strengthened the same E2E case for all-gap rendering inad6dd63.
Luna guidee137389 integrated asc052f86. Root reviewed UI, Sol independently reviewed
backend; no blocker. Agent temporary dependency symlinks removed; worktrees retained.

GET /accounting/accounts/:id/valuation-history?from=ISO&to=ISO:30elapsed-day
custom range, start+24h samples+exactend <=31points, one RR READ ONLY snapshot,
shared once-only history loads and batched indexed exact-time manual prices.
Current-effective account positions only, no inferred cash or total portfolio.
Exact scale60 strings; missing totalnull vs explicit0. Russian form/exacttable and
complete-only UTCscatter with no lines; allgapstable/nochart; stale response/input/
account/revision guards preserve the parent trade draft. No migration/dependency/
deployment change. Read archived2026-09-24-chart-account-valuations verification
and docs/valuation-history.md.

Baseline68/3pass; backend GREEN95/4 in1.966s; Sol frontend98/11 in3.05s. Both builds/
lints and strict E2E TS pass. Existing warnings:BE77,FE29,Vite>500kB. Dependencygate
exit0 with2existingmoderate, nohighcritical; lock unchanged. Strict20items pass.
Actual PGnew3families +retained valuation4families PASS;18fresh migrations, genuine
concurrent RR, preservation and31samples/100baseline/1000trades exactoracle252ms
(observation, noSLA). /private/tmp/capital-chart-db.log exit0.
HTTPS atad6dd63:3/3 in38.3s,1worker0retries:VCH-API,VCH-UI,retainedVAL-UI.
Real password/MFA/backend/PG; onlyexternalprovidersstubbed, delayedroute.fetch.
/private/tmp/capital-chart-green.log and green-artifacts. Same BEimage in PG/HTTPS:
BEsha256:9dcf0eaf717e063e7b198265498057471066dbdf57732aa23f41b2c9205d28e0
FEsha256:c9456cdf239a2a6b05e12a58b4e070d7930f1dcd407932f489f6f579b04b9d1e.
No unexpected GREEN failures. Fullbackend/fullE2E/upgrade matrix/hostedCI/production
not run this slice; all prior tests/CI retained. Docker cleanup completed, live
labeled container/network inventory empty. Installed CLI archived2026-09-24-chart-
account-valuations with7/7tasks; strict20canonical specs pass, activechangesempty.
Prior19canonical specs byte-identical; newrequirements matcharchiveddelta. Owner
Nginx bytes/mode and lock hash still matchbaseline.

## Previous historical valuation slice

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

## Completed daily display FX slice

collect-daily-display-fx archived2026-09-24-collect-daily-display-fx,7/7tasks;
strict21canonical specs pass,20prior specs unchanged. Activechangesempty atarchive.
Contract89f0a06, acceptance before implementation, backendadd57b4/UIbf4660a.
Migration19 adds two initially empty tables; opt-in fixed no-key daily indicative
USD→EUR/RUB, PostgreSQL rolling3attempts/24h, >=20min cooldown, 30s fenced lease,
last-good data, exact scale60 converter, DB-only private reads, Russian Settings.
Direct DNS connection filtering; explicit trusted egress proxy boundary. No change
to USD accounting/manual prices/chart, no new dependency or paid/production action.
Docs daily-display-fx.md/provider-feasibility.md and archived verification hold details.

Genuine predecessor HTTPS RED: anonymous401 vs404 and absent Settings item before
product implementation. Source152/6tests passed; later2DNS/proxy wiring cases added,
root focused59/2pass1.714s. Frontend101/12pass; builds/lints pass with existing
BE77/FE29 and Vite bundle warnings. Dependency gate nohighcritical,2moderate retained.
FirstPGattempt failed helper allowlist missing18 (not productRED); corrected144c770.
Fresh19/populated18 preservation/replay plus5FX/4retainedvaluation families PASS.
Independent review strengthened actual lease expiry and COMMIT witness fb60e10;
affected5FX plusdowngrade refusal PASS. Actual HTTPS3/3 in38.9s,1worker0retries,
DFX-API/DFX-UI/retainedVCH-UI. Only external providers stubbed; real password/MFA/PG.
Logs /private/tmp/capital-fx-{db-attempt1,db-attempt2,db-final,green}.log and
capital-fx-green-artifacts. No live provider availability claim.
BEsha256:514843fb64d028cdbe63deda161654147d203b750faba5dd6c9cac32f1dba2d7
FEsha256:83370644fb9133219770465629851a07b3db933984f9a629d3c592fd5e24df71
BEimage identical PG/HTTPS. Cleanup/live labeledinventory empty; Nginx/lock unchanged.
Fullbackend/fullE2E/olderupgrade matrix/hostedCI/release/production not run. Existing
CI gates/tests retained. Final independent evidence audit found no blocker.

## Completed selected manual-account valuation slice

preview-manual-portfolio-value archived2026-09-24-preview-manual-portfolio-value,
7/7tasks; strict22canonical specs pass,21prior specs unchanged, activechangesempty. Contract3129270, puref01879b/PG8da7886, Luna2E2E4b0c864, Solview8823465
precede actualHTTPSRED (validowner200 vs404, missingheading10s). Rootbackend7128c28
adds POST/accounting/manual-valuation-preview with strict1..10distinct selected
ownedUUIDs, oneRR READONLYsnapshot, shared history/exactpriceprojection, coverage
gaps separatefromzero, nullabletotal and knownsubtotal, no provider/write/cash
inference. No migrations/dependencies/chart/deploymentchange; schema19 retained.
SolUI9d1b282 integrateda38901b; visible selection retained acrosscatalogreloads,
explicitaction, staleinput/request/unmount guards. Root45cd0e9 copy/mobilelayoutfix.
Sol reviewedbackend, rootreviewedUI; no unresolvedproductfindings.

Baseline95/4pass1.669s; targeted127/5pass1.949s (32new+95retained); Solfrontend104/13
pass2.97s. Builds/lints/TS/scopedBiome PASS; existing BE77/FE29 andVitebundlewarnings.
Dependencygate exit0,2existingmoderate/nohighcritical, lockunchanged.
ActualPG3MPVfamilies+4retainedVALfamilies PASS. Real two-pool/PID snapshot barrier
across twoaccount corrections andsharedprice, exact60scale,10selectedaccounts/
11refused, invalidFIFO409, allrows/providerpreservation.10accounts/2positions9ms
observation(noSLA/maxloadclaim). HTTPSat45cd0e9:3/3in37.0s,1worker0retries, MPV-API/
MPV-UI/retainedVAL-UI; realMFA/HTTPS/backend/PG, onlyexternalprovidersstubbed.
Logs/private/tmp/capital-mpv-{red,backend-unit,db,green}.log andred/green-artifacts.
BEsha256:4b6bfc44032298aa1f4c8c342ad5ff9ac16c235d9bbf6c665fb58e227ae61c77
FEsha256:92528857004478837265653aa1651f31b73783fa9c5bbbefdb1a45d4efb222b7
SameBEinPG/HTTPS. Cleanup/liveDockerinventoryempty; ownerNginx/lockunchanged.
Fullbackend/fullE2E/oldermigrationmatrix/hostedCI/release/productionnotrun.
Read archivedverification anddocs/manual-portfolio-valuation.md. Final independent
evidence audit found no blocker.

## Completed liability editor retirement slice

`retire-liabilities-editor` archived as `2026-09-24-retire-liabilities-editor`,
7/7 tasks; strict23 canonical specs passed, 22 previous specs unchanged.
Contract/test1587ac6 and real predecessor RED before
Luna implementation122e0c0, integrated63562b9. Protected `/liabilities/*` now shows
a static notice linking manual accounts. Removed 1,853 frontend lines (20 added),
16 feature files and six obsolete wrapper tests. Backend, schema, dependencies,
Dashboard, historical chart and pipeline unchanged. Shared metrics and five
category labels retained. Sol independently reviewed contract, acceptance and
implementation; no blocker. Business rows preserved; no project folders deleted.

Baseline: frontend104/13 passed in2.90s; retained backend liabilities/manual valuation
44/2 passed in2.061s. After cleanup: Luna frontend98/12 passed in3.59s, lint passed
with27 existing warnings, build/TypeScript/scoped Biome passed. Initial Node20 loader
and pnpm metadata attempts failed; prescribed Node22 PATH then passed without any
dependency install. Source-check evidence is in agent transcript, not saved logs.
Root strict E2E types passed. Dependency gate exit0 with two existing moderate
findings, lock unchanged. Strict OpenSpec23items passed before archive.

Actual HTTPS: 2/2 passed in25.7s, one worker, zero retries: LIR-UI and unchanged
MPV-UI. Real MFA/backend/PostgreSQL; only external providers stubbed. Exact saved
rows, private API, bookmarks, zero provider calls, all-business-row fingerprints
and retained valuation assertions passed. Backend image unchanged from MPV above.
Frontend: sha256:fd9572099767a0e2a0ef0983408adcc9eb831bec44d3cb69b11ee7816b8baed8.
Logs: `/private/tmp/capital-lir-{red,green,audit}.log` and red/green-artifacts.
Cleanup live labeled inventory empty; owner Nginx mode/hash unchanged. Full backend,
full E2E, older upgrade matrix, hosted CI, release scans, live providers and production
not run. See the archived verification record for evidence and limits. Luna's final independent
evidence audit found no discrepancy. Active changes empty after archive.

## Completed bounded endpoint TWR slice

`preview-endpoint-twr` archived as `2026-09-24-preview-endpoint-twr`,7/7tasks;
strict24 canonical specs passed,23 previous specs unchanged, active changes empty.
Contract3aaaf37, root pure/PG tests6b000c3 independently
reviewed by Sol, Luna two HTTPS casesf449f70 integratedf1938f2 plus omitted-CSRF7f686d6.
Actual predecessor RED: valid API200 vs404 and missing TWR button10s, before product
implementation. Root backend7e39b45 shares strict profit input and owner RR READ ONLY
snapshot; exact BigInt endpoint ratio only with no strictly interior nonzero net flow
and positive adjusted starting capital. Missing valuations/nonpositive start are
explicit null-rate states; same-ms flows net exactly, from adjusts opening/to excluded.
Rate rounds once to12 places, half away from zero; percent derives from publishedrate,
period-only, manual/unreconciled. General linked TWR is NOT complete. No schema,
dependency/provider/chart/deployment change. Guide docs/endpoint-twr.md.

Sol UI d228647 integrated4f2305c, root e512cf5 clarifies displayed percentage rounding.
Sol independently reviewed backend; root reviewed UI; no blocker. Baseline82/2 pass;
targeted109/3 pass2.92s (27new+82retained), frontend98/12 pass. Builds/lints/types/Biome
pass with existing BE77/FE27/Vite bundle warnings. Production gate exit0, two moderate
findings retained. ActualPG four TWR and four retained profit families passed, including
1000heads, >page/corrections/voids/foreign isolation, separate real PIDs/RR barrier/
COMMIT witness, all-row/provider preservation. HTTPS3/3 pass36.7s,1worker0retries:
TWR-API, TWR-UI, unchanged XIRR-UI/LATE; real auth/backend/PG and actual delayedfetch.
Logs /private/tmp/capital-twr-{red,db,green,backend-unit,audit}.log and red/green-artifacts;
frontend logs same prefix. Cleanup live labeled inventory empty, Nginx/lock unchanged.
BEsha256:a1975ae4405b23b463845dab0fb46171524b0f9129b8b104d14ae251e7623277
FEsha256:3a3a6c834db933168a0af0aa06b8a5df01e499a3c68cfef2ca1832f19e0aa919
Same backend in PG/HTTPS. Full backend/full E2E/older upgrade matrix/hostedCI/release
scans/liveproviders/production not run; no owner data or project folders changed.
Luna independently audited final verification evidence; no discrepancy.

## Completed manual linked TWR slice

`preview-linked-twr` archived2026-09-24-preview-linked-twr,7/7tasks;
independently reviewed/targeted GREEN.24prior canonical specs byte-identical;
new canonical requirements match archived delta; guide archive link resolves.
Post-archive strict25canonical specs pass; activechangesempty. Luna final evidence audit
found no unsupported success claim; live labeled Docker inventory empty.
Contractd0fa11f, root pure/PG acceptancef076da6 reviewed by Sol; Luna two HTTPS cases
64be0fb integratede4c0c2c. Actual predecessor RED before product edits: valid plan200
vs404, absent new heading10s. Rootbackendbda97f7, SolUI83fd26a integrated97058af,
Lunaguidec1bc65f integrated0d78172, root stronger UI assertions5cd0791.

GET twr-boundaries + POST linked-twr-preview: complete owner RR READ ONLY snapshot,
revision-pinned reviewed manual preflow values, sameUTCms netting, from adjustment/
to exclusion, <=32interior nonzero instants. Exact BigInt rational linking and one
final scale12 rounding; no intermediate rounding. Missing/overcapacity/nonpositive
capital return explicit null rates; stale409 precedes semantic mismatch. Russian
separate section retains plan on value edit, resets onperiod/owner/409 and suppresses
late actual replies. Existing profit/XIRR/endpointTWR unchanged; chart untouched.
No migration/dependency/provider/write/deployment action; schema19 retained.

Baseline109/3pass; scoped215/6pass3.087s, frontend98/12pass3.03s. Builds/lints/types/
Biome pass with existingBE77/FE27/Vite warning. Productiongate exit0,2moderate/nohigh-
critical. ActualPG4LTWR+4retainedTWR families pass:1000heads,32/33boundaries, actual
separatePIDs/committedcorrection/RR/COMMIT, all-row/provider preservation. HTTPS3/3
pass36.9s,1worker0retries:LTWR-API,LTWR-UI,unchangedTWR-UI. Auth/backend/PG real;
only external providers stubbed and delayedroute.fetch uses actual response.
Logs /private/tmp/capital-linked-twr-{red,db,green,backend-unit,audit}.log and
red/green-artifacts; frontendlogs sameprefix. Root reviewed UI, Sol backend: no blocker.
BEsha256:8731e328a76f1d35cd33fa8d985ca235f744d58675c89dd10c409ee54b1cfc9c
FEsha256:4dd2bcef305e76c7a1f5e6506b9ee85d90b46ad77fecd6d4a811b8438586c19e
SamebackendPG/HTTPS, harnesscleanupcomplete, Nginx/lockunchanged. Fullbackend/fullE2E/
olderupgradematrix/hostedCI/release/liveproviders/productionunrun. Read archived
verification and docs/linked-twr.md for scope/evidence; manual valuations remain required.

## Current FIFO prerequisite and next transfer capability

Active change refactor-fifo-lot-intervals atccb70b0/0cac33c: interval allocation
helper extracted under unchanged public FIFO/carry-in contracts. Baseline240tests/
7suites passed2.327s; no artificialRED for pure refactor. Root added independent
partition/bounds/highprecision oracles, independently reviewed by Sol. Luna owns
only fifo.ts/fifo-lot-interval.ts in capital-tracker-fifo-intervals worktree.
Root owns integration, Docker, evidence/archive. Selected actualPG usd-trades-db/
carry-in-db plus unchanged TRADE-003-A/TRADE-006-A UI journey and CARRY-004-A CSV
journey; no additional E2E cases. Verification still pending.

Next implement actual persisted owned transfers, not another preview. Shared
original-coordinate intervals are a prerequisite, not completion of transfers.
Rejected freezing sender history and disallowing onward transfers: persisted cost
fragments would stale on source corrections. Use immutable commands and dynamic
connected-account replay; arrivals are available only from transfer time but ordered
by original acquisition provenance thereafter. Old trade/CSV changes must revalidate
all dependent histories; use owner-before-account writer lock ordering. Recipient
pinned views must invalidate on upstream changes. Keep local version count distinct
from journal revision/derived invalidations. Consume an explicitly declared fee asset
from source once; report its cost basis separately without a tax/fairvalue claim.
No synthetic buy/sell or external USD flow. Detailed persistence/revision/cap contract
is not frozen yet; independently review before transfer implementation.

## Remaining full goal

The active goal is to continue all remaining target requirements, not merely close
this prerequisite. Complete each change through verification/archive before the next.
User2026-09-24 defers chart/max-period review until overall completion; keep current
30-day behavior now, revisit with owner feedback later. Whole brief still needs
automatic prices/longer history/charts, automatic all-account allocation,
transfers/swaps/rewards, blockchain reconciliation, optionalAI and release/backup-
restore hardening before consolidation. Selected manual valuation is not complete
whole-portfolio value/cash accounting. Legacy UI/API simplification remains scoped
work with data preservation. CoinGecko permanent retention remains unapproved;
FX end-use permission does not remove that blocker. Do not move/delete folders now.
Reuse carry_docs_review Luna(simple) and historical_ui Sol(complex/review).
gate_acceptance quota-limited untilSep29; do not retry/purchase.
