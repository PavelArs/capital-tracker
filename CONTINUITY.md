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
Read docs/frontend-redesign-plan.md (FUI-01..06, partial or pending) and the dated target-brief
amendment. This covers navigation/workflows/all screens, not CSS polish alone. Swap
runtime and independent review now pass; swaps and initial frontend slices are
archived. The next owner visual review is after redesign; current functional UI checks are not UX approval.

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
checks to recover context. Archived capabilities now include schema22 asset swaps. Read
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

## Latest independent review and archives — 2026-09-26

Owner reported restored quotas. Independent agents ran in detached worktrees at175120a:
Sol reviewed shell/directory/workspace/workflows and screenshots; Astra reviewed swaps
finance/persistence/security/recovery and actual evidence; Luna audited docs/link status.
No paid fallback. Read docs/reviews/2026-09-26-frontend.md and the archived swap review.md.
All five changes archived via OpenSpec1.2.0 after required findings were resolved:
- record-asset-swaps:12/12, schema22 exact swaps, explicit fee source and nullable evidence,
  connected FIFO/CSV/history, immutable owner-scoped create/correct/void and SPA recovery.
- redesign-application-shell:8/8, responsive grouped navigation/manual-account landing,
  honest legacy access, restrained real login/MFA and focus behavior.
- redesign-account-directory:6/6, accounts lead, explicit mounted creation and valuation,
  retained name/request ID/error, pagination and exact selected-account preview.
- redesign-account-workspace:6/6, mounted operations/analytics/initial-data sections,
  preserved retry/eligibility guards and honest saved-opening labels.
- focus-account-operation-workflows:6/6, individually visible trade/swap/reward/CSV editors,
  mounted independent drafts/File, shared results and correction/void reveal.
Archives: openspec/changes/archive/2026-09-26-<name>/. Active changes are empty at this checkpoint.
Canonical comparison verifies42delta/97untouched requirement blocks and20byte-identical
untouched spec files;33canonical specs pass strict validation. All required behavioral
and review work was complete before archive; each final checkbox includes the subsequent
archive/comparison procedure and is marked only after it passed.

Final followup evidence: docs/reviews/2026-09-26-verification.md. Test-only7773bb77,
integrated as aad33a9, closes two review-identified CSV evidence gaps in existing PG
fixtures. Root actual swaps-pg exits0 with7PASS lines across6families plus explicit
negative CSV subcase: invalid earlier sale strands later swap without row/pin changes;
real two-PID RR/READ ONLY concurrent CSV preview returns complete old/new DTOs, exact
pins4→5/hash/basis30→40/profit50→40, once-only swap loads and stale confirmation409.
Earlier SQL55refusals, populated21 preservation, process/bounds and other gates remain
in the archived dated verification, not replaced by unit/mocked claims.

Independent frontend review found old global instrument draft name/symbol retained on
parameter-only account-route navigation. Actual RED on FE795d1b7a expected empty name,
received previous draft. Fix94f4bd7 resets only those fields in the existing route reset;
extended existing WORKSPACE-UI retains all old oracles and adds account-route coverage.
Independent reviewer approved fix and actual GREEN. Latest real WORKSPACE/WORKFLOW2/2
PASS25.7s plus SWAP-UI1/1PASS13.2s,1worker0retries, actual HTTPS/password/MFA/backend/PG.
Frontend118tests/21files PASS3.92s; separate build/lint/types pass,27existingwarnings and
bundle warning remain. Initial import-order format error explicitly corrected; final
scoped check passes. Productionauditexit0,2moderate/nohighcritical. Logs and synthetic
artifacts /private/tmp/capital-reviews-*. No full suite/release/production claim.
Final FEsha256:64923db446c89cc808f1de71bc28392484e60e06208136a84bb77ab2df528631;
unchanged BEsha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2.
Prior workspace final local build failure remains corrected in its archived record:
unsupported Testing Library exact options were removed in175120a; the old combined
shell command had masked that failure with successful lint. Docker/E2E actually passed.
Never infer one check's exit from a later successful command.

## Compact journal context — 2026-09-26

Change `compact-journal-context` adds a short initialized-journal scope notice and
native closed details/summary with exact existing metadata/caveats. Uninitialized
guidance and all shared errors/receipts/retry remain outside. No controller/key/backend
change. Worktrees capital-tracker-journal-context and capital-test-journal-context;
Sol acceptance/review, Luna copy inventory, root integration/Docker. All six final
compact/expanded360/768/1440px screenshots independently reviewed. Read archived
verification.md/review.md for evidence and limits; preview remains unchanged.

Actual preimplementation RED on FE64923db4: exact revision expected hidden, visible.
First candidate1pass/1fail: new identity test searched hidden role group; QA fix8df86c6
selects the matching workflow before strict original-node assertions. Final real
WORKFLOW/WORKSPACE2/2PASS26.5s,118/21frontendPASS3.84s, build/lint/types/scoped style
and dependency gate pass. Existing27lint/bundle warnings and2moderate advisories remain.
No full E2E repeated. Final independent approval, no remaining bounded-scope findings.
Logs/artifacts `/private/tmp/capital-context-*`; failed run preserved separately.
FEsha256:ab29708ca75a9b60c738ecd9d63d92abb2150c51a3f12e221a4a001756c822b4;
BEdd90a8c5 unchanged. E2E containers/networks empty; owner Nginx/lock above unchanged,
preview stopped32hours with original volume/tags intact. Product/evidenceffab187;
archived as2026-09-26-compact-journal-context using installed CLI. All5tasks complete:
3new requirement blocks match exactly,33old canonical files byte-identical,34strict
specs pass; active changes empty. Only task dependency symlinks removed, worktrees kept.

## Trade workbench — 2026-09-26

`redesign-trade-workbench` follows0370395: grouped native trade fields with attached
USD/UTC/order guidance, explicit guarded correction/void focus and original-button
cancel return with disconnected-origin fallback. Shared results retain exact semantic
tables/controllers; theme controls have44px targets and contained scrolling. Worktrees
capital-tracker-trade-workbench, capital-test-trade-workbench and capital-tracker-trade-results-style;
Sol acceptance/independent review, Luna CSS, root composition/Docker. Evidence in the
change verification.md/review.md, logs `/private/tmp/capital-workbench-*`.
Actual predecessor RED: keyboard correction leaves history action focused. Candidate
118/21frontendPASS3.64s, build/lint/types/style/audit pass;27existing lint warnings,
bundle warning and2moderate advisories retained. Two candidate test assumptions were
corrected with independent review: native select label lookup and disabled-refresh
focus. Exact identity/recovery/business oracles retained. No product/backend/retry
regression found; full redesign and preview update remain separate work. Final CSS
refinement461ee0c preserves normal table-word widths and contained exact-value overflow.
Final actual WORKFLOW/WORKSPACE2/2PASS29.5s on
FEsha256:8e48e2fa1d3efd6196e1267446cf5bdde47afa79b772d395a80684bc8589844a,
unchanged BEdd90a8c5. All12settled light/dark360/768/1440 screenshots inspected;
types/style checks pass. E2E containers/networks empty; preview stopped33hours,
original volume/tags and owner Nginx/lock unchanged. Independent final approval and
product/evidence661ccc8; archived2026-09-26-redesign-trade-workbench,6/6tasks complete.
3new requirement blocks match,34old canonical files byte-identical,35strict specs pass,
active changes empty. Task dependency symlinks removed; all worktrees retained.

## Acquisition entry — 2026-09-26

`redesign-acquisition-entry` follows0fc48f7: grouped swap/reward forms, associated
financial/time guidance and shared scoped OperationForm.css extracted from trade.
Luna agents own the two component worktrees, Sol acceptance and independent review;
root integrates in capital-tracker-acquisition-entry. All handlers/guards/options
retain baseline semantics; controllers/backend/schema/pipeline untouched.
Actual RED: both missing accessible descriptions on predecessor FE8e48e2fa.
Candidate118/21frontendPASS3.15s; build/lint/types/style/audit pass,27existing lint
warnings,bundle warning and2moderate advisories retained. Real WORKFLOW/REWARD/SWAP
3/3PASS44.0s,1worker0retries; all26 requested screenshots independently approved.
FEsha256:73f4c11a8eee1496177581248c26642c77accb953173e762130eb392c8a9a707;
unchanged BEdd90a8c5. Logs/artifacts `/private/tmp/capital-entry-*`, review and exact
limits in change verification.md/review.md. E2E resources empty; owner Nginx/lock
unchanged; preview remains stopped33hours with original image/volume. Task dependency
symlinks removed, all source worktrees retained. Product/evidencef2af2d2; archived as
2026-09-26-redesign-acquisition-entry with7/7tasks complete. Three new requirement
blocks match,35old canonical files are byte-identical,36strict specs pass and active
changes are empty. These results cover this bounded form slice, not the whole redesign.

## Next work and remaining whole goal

Continue complete frontend/UX redesign in docs/frontend-redesign-plan.md. FUI-01/02/03
are partial; FUI-04/05/06 and owner visual approval remain open. Next small slice:
CSV import and transfer/flow editors, then analytical/settings
screens and wider result hierarchy. Compact context and trade entry/focus are complete.
Carry the focus convention into other editors; track delayed create completion and
focused desktop-navigation collapse on resize as nonblocking UX review followups.
Keep chart/max-period expansion deferred for the owner's later review.

Still required: broader import/automatic reward and chain reconciliation; automatic
prices/retention/history; whole-portfolio allocation/cash UI; six network adapters with
honest coverage; optional AI; release/security/backup-restore hardening and consolidation.
Selected manual valuation is not complete all-account/cash accounting. CoinGecko
permanent history retention remains unapproved. Accounting locks have no dedicated
transaction-local timeout; track explicit policy/held-lock refusal/reusable-key tests
as shared release hardening. Current race tests prove serialization, not bounded waits.
Instrument receipt labels currently depend on the create/read-only catalog remaining
immutable; future catalog edits require explicit receipt preservation.

No preview update, owner DB access, production rollout, remote push or project cleanup.
Preserve preview volume/MFA/TLS/credentials, old image tag7eff01d1 and stopped containers.
Review worktrees remain for inspection. Root alone owns Docker, migrations, locks and
deployment; protect owner Nginx/lock hashes above. Follow worktree/model-routing rules
for the next independent tasks; prior quota errors are historical, not a current blocker.
