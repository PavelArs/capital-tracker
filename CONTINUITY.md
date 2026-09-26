# Capital Tracker refactor continuity

## Goal and limits

Continue the WHOLE target in capital-tracker-openspec-prompt.md. It remains
substantially incomplete. Read AGENTS.md, Git diff and current OpenSpec first.
No paid services, production/owner database access, remote push or folder deletion.
Consolidate into capital-tracker-old only after the whole verified refactor and
inventory in docs/consolidation-plan.md. Original projects/data remain untouched.
The user defers chart/max-period review; current chart remains a bounded 30-day
account series. Legacy Dashboard is not the investment-accounting source of truth.

Owner2026-09-26 reviewed the preview and rejected the current visuals/usability.
Complete frontend redesign is now required: modern restrained responsive Russian UX,
functionality first, optional early-2000s influence, no excess decoration/animation.
Read docs/frontend-redesign-plan.md (FUI-01..06, all pending) and the dated target-brief
amendment. This covers navigation/workflows/all screens, not CSS polish alone. Finish
the current swap gates, then begin the redesign in small verified changes. The next
owner visual review is after redesign; current functional UI checks are not UX approval.

Branch: refactor/brownfield-baseline. Root owns migration/dependency/deployment/
shared runner integration and Docker. Isolated worktrees for independent work;
Luna for simple bounded tasks, Sol/stronger for accounting/security and independent
review. Short periodic Russian updates; simple compatible code. Use scoped checks
per owner2026-09-23; full E2E is not required each slice. Existing CI gates retained.
Review test pyramid before deleting redundant cases; preserve critical journeys.

Owner frontend/nginx.conf remains unstaged: mode0644,size1348,SHA256
115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432.
pnpm-lock.yaml SHA256
6a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d.
Never stage Nginx or change lockfiles incidentally.

## Tooling and verification

Images pin Node22.21.1; host uses available Node22.23.2 after external removal of
22.21.1. PATH=/private/tmp/capital-task-bin:/Users/pavelars/.nvm/versions/node/v22.23.2/bin:$PATH
pnpm10.33.0, OpenSpec1.2.0, Playwright1.63.0, PostgreSQL16.10. Respect per-package
Biome configs. Frozen installs need ordinary store access; do not remove node_modules.
OpenSpec supports new change/status/instructions/validate/archive, no verify command.
OPENSPEC_TELEMETRY=0 openspec validate --all --strict --no-interactive.
Specify -> real expected acceptance RED -> implement/refactor -> independent review
-> scoped verify -> archive. Pure refactors retain passing characterization tests.

Root alone runs tests/e2e/compose.yml, project capital-tracker-e2e, synthetic PGtmpfs.
Use caffeinate -is for long runs, never production Compose. Real HTTPS/password/MFA/
backend/PG; only external providers stubbed. route.fetch plus abort is used only for
actual committed-response-loss acceptance. Record failures, warnings and unrun gates.
Latest actual labeled Docker container/network inventories were empty after cleanup.

## Owner local preview — preserve across development

On2026-09-24 the owner requested a local look. A separate `capital-tracker-preview`
Compose project was created at https://127.0.0.1:8444 (only loopback published).
Sep26 live inventory found its containers stopped29hours earlier; its durable volume
still exists. This turn did not restart/remove/reset it. It has its own172.30.101.0/24 subnet, pinned preview image tags,
`capital-tracker-preview_preview_data` durable volume, MFA key/TLS/config/credentials
in ignored tests/e2e/.runtime/preview. Never remove/reset its volume, key or owner data
as part of e2e cleanup, project consolidation or continuation. Tests retain separate
capital-tracker-e2e/8443/172.30.90-91 networks and disposable DB. Old stopped
capital_tracker_* containers and original project remain untouched.

Local private ACCESS.md has login/recovery/TOTP details and safe `manage.cjs up|stop|status`
commands; do not print/commit credentials. Owner created via actual production CLI;
MFA prepared/confirmed via actual CLI. Browser/password/TOTP/private-denial and explicit
logout verified, demo operations created through real protected HTTPS APIs. Two demo
accounts have buys/sale/swap/reward/transfer and8daily manual prices per asset. Actual
browser valuation41960 and rendered chart passed with no client errors; helper exact
USD-sale10000/swap9990 assertions passed. Log /private/tmp/capital-local-preview-smoke.log.
Initial startup inherited unexpanded YAML environment; bootstrap refused before creating
an owner. Explicit merge expansion fixed config; second startup/migrations/no-reset and
browser smoke passed. Logs /private/tmp/capital-local-preview-start{,2}.log.
Preview uses BEdd90a8c5/FE7eff01d1 already tested above; no image rebuild/deployment.
Its external provider fixtures are demo data, not live chain or market observations.

## Completed capabilities

Canonical openspec/specs describe verified behavior; archived changes hold concrete
acceptance, design, persistence and command/image evidence. Do not replay all historical
checks to recover context. Archived capabilities use schema21; active swaps add22. Read
brownfield-audit.md before any legacy upgrade because old migrations have destructive
history and explicit preflight refuses unsafe states.

Completed slices: baseline/pipeline containment, isolated release-image acceptance,
CLI owner bootstrap, opaque revocable sessions, mandatory TOTP, trusted proxy address
attribution, persistent authentication limits, dependency fixes, manual accounts and
opening/carry-in states, exact FIFO trades and CSV import/rollback, historical holdings,
external USD flows, period profit/XIRR, manual exact-time USD prices, historical account
valuation, bounded account chart, indicative daily display FX, selected manual-account
valuation, legacy liabilities frontend retirement, endpoint/linked TWR previews,
original-coordinate FIFO intervals, and owned transfers below.

Owner guides in docs link each corresponding archived verification record. Most recent
predecessor images (before transfers):
BEsha256:f1f480d4a1039aa89b909075d162273697253c755413c680d48bf01c47c09e3a
FEsha256:4dd2bcef305e76c7a1f5e6506b9ee85d90b46ad77fecd6d4a811b8438586c19e.

## Completed owned transfers

record-owned-transfers archived2026-09-24. Read archived persistence.md/tasks.md/
verification.md and docs/owned-transfers.md. Source implementation52cbfa8/a3c5d23,
frontend2764a65/39b71d4, acceptance maintenanceb200e64/bbe99ee, final evidencec7c2909.
Root archived only after required runtime/source gates passed. Last task includes
post-archive canonical comparison, documentation and cleanup. All10tasks complete;
strict27canonical specs pass, active changes empty. All25delta blocks match (blank-line
normalization only),14untouched blocks retained,19unrelated spec files byte-identical.

Already-performed manual movements with immutable create/correct/terminal-void
commands, exact principal/explicit fee-asset consumption, original lot coordinates/
provenance and latest arrival. No synthetic trade/external USD flows. Connected
replay dynamically restates upstream corrections; owner advisory lock precedes account
row locks. Validate union of old/new components and every participant revision budget;
void invalidates disconnected accounts too. Request replay precedes CAS/caps and returns
unchanged receipts. Local trade versionCount is distinct from shared currentRevision;
CSV consumes its contiguous N source ticks, passive participants one per command.
All reads share one RR READ ONLY snapshot; load connected histories once.

Bounds: owner1000active transfers/10000versions; component32accounts/10000active trades/
1000transfers; per-account1000trades/100carrylots/10000revision ticks; replay100000held
fragments/matches. Derived paging offsets0..99999; raw heads0..9999. Exact numeric
strings and connected continuation pins; chart/selected portfolio use full histories.
Protected Russian /owned-transfers review workflow retains ambiguous commands for
identical explicit retry, handles late responses and renders original/arrival provenance.

Actual scoped results (full details and failed attempts in archived verification):
- Backend368tests/13suites, frontend101tests/14files pass; both builds/lints, strict
  E2E TypeScript and source syntax pass. Existing77BE/27FE warnings, Vite>500kB warning.
- Production dependency auditexit0:2existingmoderate, nohighcritical. No lock change.
- Core PG attempt2 all7families pass, including actual process/advisory/CAS races,
  deferred COMMIT rollback witness, connected CSV and two-connection snapshot tests.
- Ownercap/retained trade/CSV/carry/history suites pass. Initial chart COUNT oracle
  conflated preflight and materialization; corrected explicit one-of-each oracle passes
  focused chart rerun. Bounds pass1101positions/full valuation/series once-only reads,
  10001lot/match pages and provenance/upstream stale pins.
- Genuine preproductHTTPS RED at20b94ac: new validPOST404 and absent page heading.
  First GREEN attempt:3retained pass,2new fail (volatile timestamp comparison and
  select accessible name). Corrected exact stable privacy envelope/ISO checks and
  explicit visible aria labels; focused new2/2 pass28.1s,1worker0retries. No weakened
  financial/retry/privacy assertions. Separate reviewers inspected traces/fixes.
- Fresh20, populated19 plus affected14/15/16/18 predecessor upgrades and17price
  upgrade all pass/preserve rows. Native original-schema fixture construction replaces
  invalid use of current services; post-upgrade verification still uses real services.
- Full backend/E2E, older8–13 upgrade matrix, hostedCI/full release/security/backup
  gates NOT run this slice. Existing tests retained; runner includes new PG fixtures.

Accepted BEsha256:01e43db63bc3faf2227f9b383c28da4650124361d38c65f68a451647151b30d3
Accepted FEsha256:184462cbef67047af371da2c8ede0577912823db35fdf047f5c35c3aed5c839a.
SameBEimage in actualPG/HTTPS; FE rebuilt for select labels. Logs/harnesses/artifacts
/private/tmp/capital-owned-transfer-*. Nginx/lock preserved, synthetic resources cleaned.

## Completed asset rewards

record-asset-rewards archived2026-09-24. Read archived persistence/tasks/verification and
[owner guide](docs/asset-rewards.md). Pure coreae9a677, parser153682c, backend1148f1b,
existing consumers4c92516, editor5aa4b43/fdfa263, parent integration0d834bc; final test-only
privacy path correction and real SPA recovery test are in the archive commit.

Owner-attested received rewards have independent nullable basis/income; unclassified is a
reward subtype requiring review, not arbitrary incoming economic classification. No inferred
price, external flow, tax basis or duplicated income. Original intervals/provenance survive
sales/transfers/fees; incomplete costs carry exact known subtotals. Shared connected pins
advance once; trade version counts remain real counts. Reward income remains source-only.
Full immutable create/correct/terminal void and replay-before-CAS/caps. Private Russian form
retains frozen command/body/pins/evidence across SPA remount, blocks stale review and preserves
the separate trade draft. A full browser reload is not durable pending-command recovery.

Actual required scoped gates passed:
- Backend385tests/16suites, frontend103tests/15files; builds/lints/strict E2E types and specs.
  Existing77BE/27FE lint warnings, Vite chunk warning, proxy http2 deprecation remain.
  Production audit2existingmoderate/nohighcritical; lock unchanged.
- PGmain7families: fresh21/populated20/noop/old row and receipt preservation; exact economics,
  lifecycle/SQL/deferred COMMIT rollback witness; two-PID RR; connected CSV; once-only series
  and selected valuation loads. Fixture attempt2 used a wrong price pin; explicit global
  instrument pins1,2 fixed setup and attempt3 passed. No financial oracle was weakened.
- Bounds4families: real two-process advisory-lock races, actual1000th active reward accepted,
  owner10000versions with spare local ticks, local/passive10000revision limits and replay.
  Retained transferPG passed plus fresh21/populated18 actual encrypted MFA/session/financial/
  schema preservation and populated19 transfer upgrade. Older8–17matrix/full suites unrun.
- Genuine predecessor HTTPS RED2/2 before API/UI/persistence. First GREEN4/5: reward UI and
  retained transfer/trade/valuationUI passed; API assertion wrongly included proxy/api prefix
  in server error path. Exact /accounting expectation matches unchanged exception filter;
  independent reviewer approved, private/financial assertions retained. Focused rerun2/2
  passed27.7s, same images,1worker0retries; added actual SPA remount recovery plus delayed real
  versions response/concurrent correction/list-refresh guard and trade draft preservation.

Accepted schema21BEsha256:176f668b0c6a77e78961600a3b989446f2bd479a8bcbd9a933142b8e5684d25f
FEsha256:fe42b103d5daf60de1ad13c2415defbbf0f948e5398ef37e627763e489a7069e.
Logs/harnesses/artifacts/private/tmp/capital-rewards-*. Root owns Docker and migrations;
only synthetic tests/e2e/compose.yml used. Final labeled Docker inventories empty; owner
Nginx/lock hashes above preserved. No production, push, paid service or project removal.
Archive synced6added/17modified requirements:23delta blocks match except blanklines,
16untouched blocks retained,20unrelated spec files byte-identical; new Purpose clarified.
The archive command saw8/9tasks because final task includes archival/postcomparison; its
last checkbox is completed only after that procedure. No functional verification was skipped.

## Remaining whole goal and next work

Active `record-asset-swaps` is incomplete,7/12tasks done (contract+realRED, pureFIFO,input, schema/SQL, frontend).
Read its proposal/design/persistence/specs/tasks/verification before continuing. Root has
implemented backend migration22/store/API/connected-loader integration6658dbc, purecore
0e06fa9 and parser6450a57/8d0f54c. Original-lot incoming fees and preheldFIFO fees are explicit;
consideration nullable/known0 is independently preserved. Swap result is consideration
minus principal/fee consumed basis, separate from actual USD trade totals and external flows.
Incoming basis equals declared gross consideration, never inferred outgoing cost or peg.

Actual evidence so far: predecessor pure10/10RED and HTTPS2/2RED; root403tests/18suites
and build/scopedBiome pass. Schema22BEimage
sha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2.
Three new PG families pass (connected correction/receipt preservation, fee/null/zero/
allocation/lifecycle, actual deferredCOMMIT witness/rollback). SWAP-API realHTTPS passed
1/1in13.3s with priorFEimage, realpassword/MFA/PG,1worker0retries. SWAP-UI and its Russian editor are now implemented/verified below; do not mark archive-ready. Logs/harnesses are
/private/tmp/capital-swap-* and /private/tmp/capital-swaps-*; verification.md records scope.

Next: complete process/cap/snapshot/connectedCSV/
once-only-load tests, independent persistence/UI review and final scopedgates/archive. Existing20fixture
fresh counts updated21→22 with only new swap tables excluded/checkedempty in predecessor
preservation; original predecessor schemas retained. Runner includes new mainPG fixture.
Retained PG attempt1 exposed a reward preflight matcher conflating swap/reward queries;
exact1per-table plus exact1swap materialization now asserted. Attempt2passed allreward/
transfer families and fresh22/populated18auth+19+20preservation on sameBEimage. No new
swap-specificprocess/bounds claim. Engineering183tests/2suites, backendlint
(77existingwarnings), strict29OpenSpecitems pass. Final synthetic inventory empty; all
execsessions terminal, worktreesclean and Nginx/lock hashes preserved.
Root committed retained fixture/evidence checkpointd7889bd then frontend11aa6ef.
Russian swap form reviews normalized exact intent, explicit fee source and UUIDs; frozen
retry survives SPA remount, late responses cannot reinstate stale review, and USD trade
drafts survive refresh. Current/historical typed consumers show swap-origin intervals and
separate totals; paged version/allocation evidence distinguishes original/current data.
Owner guide docs/asset-swaps.md explicitly labels remaining release gates.

Actual currentFEsha256:7eff01d148e8f286c025655ffa0dd88cfa842fc051d9dd9240318c11cc60768c.
Same schema22BEdd90a8c5. Selected realHTTPS7/7PASS1.7m: new SWAP-API/UI plus rewardUI,
transferUI, valuationUI, primary USDtradeUI and fullCSVimport/rollback.1worker0retries.
SwapUI11.9s includes committed-response-loss/SPA identicalretry, exact origins/allocations,
unknown→0 correction/void and delayed actual response after concurrent pin change. Logs/
harness/artifacts /private/tmp/capital-swaps-ui-green*. Fullfrontend106tests/16filesPASS;
later supplemental6tests/2filesPASS (3new render/control tests; no API/authmock). Tests-only
type metadata/options corrected then finaltsc and3/3rerunPASS; failure evidence retained.
Build/lint27existingwarnings/scopedBiome/strictE2Etypes/OpenSpec29itemsPASS; Vitechunk/proxy
warnings remain. Productionauditexit0,2existingmoderate/nohighcritical. No package changes.
All sessions terminal, labeled containers/networks empty, Nginx/lock unchanged.
Do not repeat passed backend403/retainedPG/selectedHTTPS unless changes justify it. No full
suite/release/whole-project pass claimed. Details in active verification.md.

Sep26 root added required frontend redesign to brief/backlog/continuity inbe35646.
Swap task3.1 now passes: realPG main4families including55directSQL refusals checked
by exactSQLSTATE/full-row fingerprint, positive null/0/30-digit/fee controls, actual
deferredCOMMIT witness. `migrations.cjs --from21` constructs native populated21,
upgrades with actual CLI22, preserves every old schema/row/auth factor/session/CSV,
reward/transfer receipt, price/FX, then exact no-op/downgrade refusal. SameBEdd90a8c5;
no product change/rebuild. /private/tmp/capital-swaps-schema22-attempt1.log exit0.
Only isolated e2e resources cleaned; local preview/data remain separately preserved.
Current swap-specific races/caps/coherent snapshots/CSV/once-only loads and independent
persistence/UI review are still pending; no new browser/full-suite pass claimed.

Still required after swaps: complete frontend/UX redesign per docs/frontend-redesign-plan.md,
broader import and automatic reward/chain reconciliation, automatic price collection/retention/history, integrated whole-
portfolio value/allocation/cash UI, six network adapters and honest coverage, optional
AI, full release/security/backup-restore hardening, final consolidation. Selected
manual valuation is not complete all-account/cash accounting. CoinGecko permanent
history retention remains unapproved; display FX permission does not remove that gate.
No production rollout or folder moves/deletions now. Finish each small change through
review/verification/archive; no broad rewrite. Chart/max-period expansion deferred.

Agents carry_docs_review(Luna) and historical_ui(Sol) both hit quota untilSep30 during
swap implementation. Do not retry or purchase credits. Root inspected their stopped diffs,
reviewed/committed/integrated them; their current swap-contract/swap-core worktrees are
clean and temporary dependency symlinks removed. Earlier reward/worktrees and unused
reward-schema worktree retained. gate_acceptance previously quota-limited untilSep29.
Independent persistence/UI review remains pending, not silently replaced by earlier design
review. Root alone operates shared Docker/migrations/lockfiles/deployment.
