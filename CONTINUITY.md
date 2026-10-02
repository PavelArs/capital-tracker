# Capital Tracker refactor continuity

## Current handoff — interrupted manual + CSV MVP release

Checkpoint: 2026-10-01. The whole product remains incomplete; the manual + CSV MVP
is not deployed or release-complete. Frozen main is
0f479b3955aba1cf351a29e897c7ffbdc9909638. Trusted main CI run 36900868365 passed
20/20 critical cases on that exact source. Promotion run 36905502848 completed with
four immutable image pins: backend sha256:52d464e118000b07dde22c44f879e07dcf6755c8b73767d89b6bf1ec89301aaf,
frontend sha256:19a8074a2e0dc6fd67e41615e62e10815b497994e23d56cbbdf54b01af510cc6,
PostgreSQL sha256:c6a966be9561266a345c4c705a01a20fb82a061c3827e95b39e7127f7527f58f,
and Redis sha256:2d3814be5e9b06a30a0be54770b7e12052e7e79ec85271aefd34875c1f393b23.
Receipt, run metadata and promoted manifest are preserved in the ignored
capital-tracker-ci4-runtime/tests/e2e/.runtime/release-planning/evidence/ directory.

Owner setup completed: dispatcher installation/approval, dedicated Docker login,
targeted Nginx fix/reload, predeploy encrypted-key custody, and SSH retry preparation.
Production deploy 36914835760 failed at pg_restore after creating PostgreSQL 18 and
Redis containers, named volumes and the project network. Restore, migrations, owner
CLI and app activation did not pass; deployment remains false and postdeploy MFA
custody is pending. Preserve initialized resources. Do not fresh-bootstrap, prune,
reset, remove, recreate or retry until the reviewed recovery path is implemented and
runtime state is verified.

OpenSpec change fix-interrupted-mvp-release was strictly validated and committed as
docs commit cd1df01; implementation is underway in its separate code worktree. It
requires bounded final PostgreSQL TCP readiness and a guarded resume-fresh path pinned
to original infrastructure images. New source has no CI acceptance or deployment.
Local Docker is unavailable. Historical notes follow; preserve the owner's dirty
Nginx edit, local preview, original project/data and full deferred target.

## Historical handoff — pre-current-main release checkpoint

Checkpoint: 2026-10-01. The authorized manual-accounting + CSV MVP remains **IN
PROGRESS**; the whole product is incomplete, not deployed or release-complete.
Network sync and AI remain deferred. Latest completed published source recorded here is
`5362a65193f696cede6f3eb0ea80c60145baca60` on
`/Users/pavelars/Projects/temp/capital-tracker-mvp`, branch `release/manual-mvp`.
Reviewed E2E pause source `f46d72e` is integrated as `ba2db8b`; reviewed Axios source
`ed8c299` and its HTTP test are integrated as `1920d90` and `64384c4`. The primary
checkout `/Users/pavelars/Projects/temp/capital-tracker` remains at `0f96749` with
the owner's dirty `frontend/nginx.conf` edit; preserve it.

The latest completed hosted PR #26 run recorded here is
[36888831515](https://github.com/PavelArs/capital-tracker/actions/runs/36888831515),
**SUCCESS** on exact source `5362a65193f696cede6f3eb0ea80c60145baca60`, all 10/10
jobs (`/private/tmp/capital-mvp-ci7-run.json`). The run is archive-only CI evidence:
real acceptance/E2E and candidate export/upload were skipped. It establishes no runtime
acceptance, tested candidate, promotion or deployment. The earlier green run
[36886571152](https://github.com/PavelArs/capital-tracker/actions/runs/36886571152)
on exact source `f85a638da84b3f9f5df2e146aaaa8f9cc11d9c0c` remains historical evidence;
its E2E and candidate export were also skipped. The bounded `gate-release-work-on-audit`
change is complete and archived with ENG-004/005 synced to canonical engineering gates.
Axios remediation and manual-MVP remain ACTIVE; new-image transport/TLS and selected real
acceptance were skipped in those archive-only runs. They are not release candidates,
and no real PG/HTTPS/MFA runtime acceptance, promotion or deployment is evidenced.

Historical predecessor run 36857990125 at `a661fc4` failed the production audit
(7 HIGH, 6 MODERATE) and was cancelled; its audit log remains
`/private/tmp/capital-mvp-ci5-audit-job.log`. Reviewed Axios remediation passed the
required production gate (0 HIGH/critical, 1 MODERATE Multer); the full local audit
still exits 1 for the tracked advisory due for maintainer triage 2026-10-08.
Frozen install before/after passed 64 backend tests in 3 suites and 39 frontend
tests in 3 files. Backend/frontend lint, strict types and builds, five backend HTTP
adapter cases and 195 pause policy checks passed; frontend only asserts Axios
version. These checks and hosted builds/scans do not establish runtime acceptance.
Local Docker-dependent real PG/HTTPS checks remain unrun because Docker is unavailable.

Owner decision (2026-10-01): authorize a shortened critical-release acceptance
profile after initially pausing hosted E2E for PM-TEST cleanup. Keep the manual full
suite and all test files. The shortened profile retains real PostgreSQL/domain/
migration, provider transport/TLS, CLI/MFA, startup/artifact checks and selected
critical HTTPS journeys; its candidate-bound receipt must bind source and exact
manifest. Full 174-case regression, PM-TEST cleanup, encrypted backup/restore,
off-host recovery and server/deployment gates remain distinct. Final profile source
`0823122ec202f7fd69e3bb89711200a6214b1949` has independent approval; 196 Jest checks
and four Node checks passed. Hosted runtime acceptance remains unrun. This
documentation change records no new
acceptance, CI pass, candidate, promotion or deployment. The earlier green hosted CI
run remains archive-only evidence as described above.
Local Docker-dependent image/PG/HTTPS runtime checks are unrun because Docker is
unavailable; the earlier runtime record remains historical.
Axios runtime preparation is preserved in the ignored `capital-tracker-ci4-runtime/tests/e2e/.runtime/axios-preparation/`; syntax and catalog checks passed, but runtime/build is unrun. Restore the public plan from that directory if `/private/tmp` loses it, and integrate the upgraded reviewed source before GO.
Frozen pause-workflow source `f46d72ecefddd20bf47b68259c657cc4e628d529` passed local policy checks 195/195 and strict OpenSpec 46/46; style/diff passed. Independent review approved; hosted build/scans passed in historical run 36886571152 and archive-only run 36888831515, while real DB/HTTPS acceptance remained unrun at that checkpoint. The then-proposed restoration of `CI_E2E_ENABLED=true` after PM-TEST cleanup was superseded by the owner's shortened-profile decision above. Final profile source `0823122ec202f7fd69e3bb89711200a6214b1949` has independent approval; 196 Jest checks and four Node checks passed. Hosted/runtime acceptance remains pending before candidate export/promotion.

Run 36706275247 and its 174-test partial result below are historical evidence from an
earlier checkpoint, not the latest hosted CI recorded above. Its nine reported failures retain their scoped local PASS
evidence across separate runs; this does not complete the hosted suite. Earlier local
runtime and image evidence remains historical as recorded below and in the release
verification. Older temporary receipts/scripts that are absent on this host are
historical evidence unavailable locally; do not replace or reinterpret their recorded
results. Whole-target product work and all remaining release/server gates stay open.

Pagination is fixed in frontend source `efb7e60d6c223ecadeff037eee9d0729cbc0d899`
and the OpenSpec change is archived; the canonical CSV workbench includes both new
requirements and strict validation passed 45/45. A new frontend image
`sha256:fb1c86b402438de3e153d39f9ff39f8562b6f76177b94760e2531c03ddf3d1a6`
passed CSV-006-A/B 2/2 and the separate remaining selected batch 7/7 in
315.024 seconds.
The earlier run on the old frontend had 5 passes, the CSV-006-A pagination failure
and 5 unrun tests. Across separate old/new-image scopes, 14 unique selected cases
passed, including all nine failures from the hosted run; this is not one continuous
14/14 run or evidence that the complete 174-case suite passed. Independent review
approved the final staged evidence. Receipts and the detailed case/results ledger are
in [`openspec/changes/release-manual-mvp/verification.md`](openspec/changes/release-manual-mvp/verification.md).
The failed CSV RED, 6-unit-test predecessor RED and subsequent 12/12 affected unit
GREEN, strict types, frontend build and style checks remain recorded there.

The final pagination fix adds no backend, database or deployment changes. At that
pagination runtime checkpoint no new
hosted CI, candidate promotion, bootstrap or deployment had occurred. The current
paused hosted build/scan success is recorded above; tested-candidate export/promotion
gates remain open. Next gates are trusted current-main hosted CI,
fresh promotion receipt, owner bootstrap and PAT/key custody, encrypted Mac recovery
archive, restricted dispatcher setup and inventory/preflight, controlled deployment,
post-deployment backup verification, then retirement of the old key/account and
manual-MVP archive. Preserve owner data, preview, legacy `/opt/capital-tracker/.env` and
`/opt/capital-tracker/.gitignore`, and the Nginx edit.

Separate earlier local evidence remains: the exact PG18 four-image runtime at `7274076`
passed 19/19 retained HTTPS/MFA/accounting journeys, migrations, 27 startup refusals,
CLI/artifact checks, encrypted disconnected restore/fingerprint and source
preservation; four image scans had no critical/high findings or secrets and one
backend MEDIUM. Source `55aec09` separately passed local Compose/Firefox 4/4 (three
Firefox cases plus one engine-independent API case); strict all-E2E TypeScript passed.
These checks are not hosted CI or production-release evidence.

Owner constraints: target `agm:/var/snap/docker/common/capital-tracker` for
`capital.pavelars.ru`; first-install history is resolved by zero related resources
and owner attestation that the legacy `.env` was an unused template. GitHub
`production` credentials are configured, but the public key is not installed and
the restricted `capital-release` account is not created. The owner will run `sudo`
steps and enter the classic `read:packages` PAT directly. Before deployment, require
encrypted recovery archive on the Mac and password-manager custody. Retire the unused
deploy account and old key only after verified `capital-release` cutover; preserve
other home files and never use `userdel -r`.

### 2026-09-30 later: MVP-007 restricted dispatcher (Claude continuation)

Codex hit its limit; Claude continued in worktree `capital-tracker-mvp-boundary`, branch
`fix/manual-mvp-boundary` from `976f917` (integration HEAD is `976f917`, not `4dd81e5`).
Implemented root-owned `scripts/manual-mvp-dispatcher.py`, `manual-mvp-receipt.py`,
`manual-mvp-dispatcher-install.sh`, cd.yml modes inventory/promote/preflight/deploy through
`capital-release` (no docker group), single-use owner-approved receipts, MVP-007 spec,
ENG-002 delta/tests (ENG-002 was already RED at 976f917) and `pnpm test:security` in CI.
Evidence and unrun checks: `openspec/changes/release-manual-mvp/verification.md` (MVP-007).
Task 2.5 stays open for host install, `production` environment secret and an actual
dispatcher run. Claude's device shell is a Linux VM: no Docker/Colima, pnpm, gh or server
SSH; Biome unrun there. The owner's real-server assessment returned only `assessment_unavailable`;
Docker `"Labels": null` is a plausible cause, not confirmed. A server rerun with
safe phase/class diagnostics is still required. Codex's 3 RED process tests now pass
with null-safe labels/mounts and value-free
`phase=`/`error_class=` refusal details (jest assessment 22/22). New helper SHA256
`03026ef7a44eee880f6e5c5a722c0d2e38237c5266d95f99df37bfdd03ca0a99` supersedes
the staged `59e99ed8…` copy; re-stage before the owner reruns it. Next release gates unchanged (image remediation/PG18 acceptance,
host bootstrap, hosted CI, deploy). Not merged into `release/manual-mvp` yet.


### 2026-09-30 operator resolution: first-install history

The owner ran the strict assessment: all four related-resource counts and
`unexpected_project_data_entries` were 0; `existing_env_preserved=yes`. It found
only `DB_NAME`, `DB_PASSWORD` and `DB_USERNAME`, classified the target as
`unrecognized`, and correctly returned `fresh_setup_gate=blocked` with
`reason=configuration_requires_private_review`. The owner then explicitly confirmed
that the old `.env` is an unused template and no working database containing owner
data ever existed. First-install history is resolved through actual inventory plus
owner confirmation; this does not turn the helper refusal into a passing result.
Preserve the old `.env`. Bootstrap, host privilege verification and deployment
remain pending.

## Goal and limits

Continue the WHOLE target in capital-tracker-openspec-prompt.md. It remains
substantially incomplete. Read AGENTS.md, Git diff and current OpenSpec first.
Historical isolated-preparation limits prohibited paid services, production/owner
database access and remote push; they do not revoke the owner's current explicit
authorization for the manual MVP actions described above. Owner2026-09-27
authorized deletion of proven merged worktrees; original-project deletion remains gated
by the final consolidation inventory and data-preservation requirements.
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

## CSV workbench — 2026-09-26

`redesign-csv-workbench` followsfd698a6: derived file/mapping/review guide, grouped
mapping with associated exact interpretation hints, native secondary batch identity
disclosure, scoped responsive source/preview/provenance/rollback presentation.
Controller/helpers/handlers/guards remain; no parser/backend/auth/schema/pipeline change.
Root capital-tracker-csv-workbench, Sol acceptance/review, Luna mapping and separate
mapping visual review; source commitsb779907/9618a3f. Genuine preimplementation RED:
guide absent on predecessorFE73f4c11a.118/21frontendPASS3.24s; build/lint/types/style/audit
pass,27existing lint warnings,bundle warning and2moderate findings retained.
Actual firstGREEN3pass/1test-locator failure; corrected nonexistent theme selector.
Focused rerun found real preview mobile overflow; scoped grid minimum fixed without
weakening assertion. Then4/4realjourneysPASS1.1m onFE8d319fc1. Independent visual review
found dark-label contrast and full-element capture artifacts. Scoped foreground fix,
real viewport captures without masking, final fullCSV1/1PASS27.5s on
FEsha256:e50994254810e656a7614ed9d2716fe9cdb863c4631fa3e38c17cd6cdd7e8f43;
unchangedBEdd90a8c5. Other three cases retain preceding-image evidence; no fullsuite.
Logs/artifacts `/private/tmp/capital-csv-workbench-*`;44finalframes. E2E resources empty,
preview stopped34hours with original volume/tags; owner Nginx/lock unchanged. Task
dependency symlinks removed, all worktrees retained. Independent source/runtime review
approved, all44clean frames inspected (Sol30,Luna14). Product/evidence9743139; archived
2026-09-26-redesign-csv-workbench,6/6tasks complete. Three new requirement blocks match,
36old canonical files are byte-identical,37strict specs pass; active changes empty.

## Transfer workbench — archived

`redesign-transfer-workbench` follows859f267. Grouped internal-transfer fields with
associated recipient/fee/UTC/order guidance, explicit review section, action-only
editor focus and cancellation return; history now leads with exact amount/asset and
account direction with native identity disclosure. Controllers/recovery/guarded writes
remain;14form control AST signatures unchanged. Root owns page/styles, Luna form,
Sol acceptance and separate Sol source/history review; independent Luna editor review.

Actual RED on prior FEe5099425: missing recipient accessible description. Final product
5d52cac integrates form06c0514 from41a49ce and acceptance42f918f from5144617. Author
component-test attempt had known ERR_REQUIRE_ESM worker startup; root Node22.23.2
all118tests/21files PASS5.47s. Build/lint/types/style/audit/specs pass; existing27warnings,
Vite chunk warning and2moderate/nohighcritical remain. GREEN2/2PASS31.5s: TRANSFER-UI
14.8s with exact committed retry/correction/void/fee/holdings and WORKFLOW-UI16.0s.
RealHTTPS/password/MFA/backend/PG22migrations, no own-backend/auth mocks.

FEsha256:ebdc0e74e6e439bc93a492f46f71f61b2e45f8ad8308900fa321664aa54da0b7;
BEdd90a8c5 unchanged.24light/dark360/768/1440 actual viewport frames independently
reviewed, no blocking findings. Captures cover blank create editor and saved
allocation/version history; other states have browser assertions, not visual approval.
Minor desktop field-grid whitespace is nonblocking. Logs/artifacts
`/private/tmp/capital-transfer-workbench-*`. E2E resources empty; preview volume/image/
stopped containers, owner Nginx and lock preserved. Full suites/backend/upgrades/live
providers/scanners/hostedCI/release not rerun for this frontend slice.

Archived at openspec/changes/archive/2026-09-26-redesign-transfer-workbench. Three new
requirement blocks match canonical;37previous spec files byte-identical; strict38
canonical specs pass and active changes empty. All6tasks complete; product/archive56b6856
fast-forward integrated into refactor/brownfield-baseline. Temporary dependency links
unlinked; primary dependencies and all worktrees retained.

## External flow workbench — 2026-09-27

`redesign-external-flow-workbench` follows75a0f6b. Root TSX34aee29 and Luna CSSa19c8d4
(integrated26bd124, root followups b514f64/20d9feb) add associated exact-USD/time/period
guidance, native rules/identity disclosure, action-only correction/void/version focus,
cancel/close return and contained responsive tables. Eleven form/input signatures and
ten financial/recovery/read controller definitions remain structurally unchanged.
No backend/auth/schema/pipeline/dependency changes. Sol authored acceptance5df23b9,
root independently reviewed tests and fixed pre-initialization guidance ordering in
303f430. Sol separately reviewed root/Luna product and all26actual viewport frames;
the report does not claim independent review of its author's own tests.

Actual predecessor RED on FEebdc0e74: absent new rules summary. Final frontend118/21
PASS4.89s; build/lint/types/style/audit/specs pass. Existing27warnings, bundle warning
and2moderate/nohighcritical remain. GREEN2/2PASS33.2s: FLOW-004-A17.8s and retained
FLOW-004-B14.7s, one worker/zero retries, actual HTTPS/password/MFA/backend/PG22migrations.
Exact financial/stale-read/recovery/fingerprint/admission/provider assertions retained.
FEsha256:048b059e457731b7692617f1484d9d8fac29bc50cae7aecbc8fc758516ba089c;
unchangedBEdd90a8c5. Logs/artifacts `/private/tmp/capital-flow-workbench-*`.
No blocking source/visual findings; native ISO inputs can clip their visible text at768,
with complete returned interval still readable. Full suites and broader release gates
were not repeated. Archived as2026-09-27-redesign-external-flow-workbench: all3new
requirement blocks match,38previous canonical files remain byte-identical, strict39
canonical specs pass and active changes are empty. Product/archive a5bc7f3 is
fast-forward integrated; all6tasks complete. Five exact temporary dependency links
unlinked; primary dependencies and all worktrees retained. Owner Nginx/lock and the
stopped preview containers/image/volume remain preserved. No E2E resources remain.

## Period review workbench — 2026-09-27

`redesign-period-review-workbench` follows97ca8da. RootTSX17d5d46, LunaCSS7418c04
integrated7312fbb and rootstylefixbcb9699 add native method/evidence disclosures,
grouped period/valuation fields, distinct exact primary metrics and an optional mounted
linked-TWR workflow. The native wrapper is outside the unchanged period-key component;
folding preserves reviewed values/plan/result, while original date/valuation changes
and delayed replies retain their invalidation semantics. All15control/props signatures
and module/pre-render controller logic remain structurally unchanged. No backend/auth/
schema/dependency/pipeline change. Sol acceptance74f464c/b8a229a integrated7a7c22e/5c3824a.

Actual predecessor RED onFE048b059e: missing method disclosure. Final118/21frontend
PASS3.94s; build/lint/types/style/audit/specs pass; existing27warnings,bundle warning
and2moderate/nohighcritical remain. Actual GREEN4/4PASS51.7s: LTWR14.7,PROFIT13.1,
TWR11.7,XIRR11.5, one worker/zero retries, realHTTPS/password/MFA/backend/PG22migrations.
Existing exact finance, error, stale-plan, late-response, fingerprint, admission and
provider assertions retained. Source/oracle review and20profit screenshots independently
approved; separate product review approved22linked frames. No blocking findings.
FEsha256:78436d00c6a36f0109abe0505dbff20fc21d8fe67642cc605b79d3dc51b3fa41;
unchangedBEdd90a8c5. Logs/artifacts `/private/tmp/capital-period-workbench-*`.
Captures cover reviewed profit/linked states; XIRR/TWR have runtime assertions but no
dedicated card screenshots. Broad accessibility/full suites/release gates remain unrun.
Archived as2026-09-27-redesign-period-review-workbench:3newrequirement blocks match,
39previouscanonical files remain byte-identical, strict40canonical specs pass and
active changes are empty. Product/archive55600d8 fast-forward integrated; all6tasks
complete. Seven exact temporary dependency links unlinked; primary dependencies and
all worktrees retained. Owner Nginx/lock and stopped preview containers/image/volume
remain preserved; no E2E resources remain.

## Manual price workbench — 2026-09-27

`redesign-manual-price-workbench` followsd4dd415. RootTSX62c1eb2, LunaCSSeb5a3c6
integrated0716ee4 and rootfollowup366b1b3 add focused entry before evidence, native rules,
associated exact guidance, void/history focus and close/cancel return, semantic contained
tables and responsive controls. Four input signatures,20financial/read/recovery
controllers and six save/confirm/load guards/callbacks remain structurally unchanged.
No backend/API/auth/schema/dependency/pipeline changes. Sol acceptance9263a91 integratedc7937ab.

Actual predecessor RED onFE78436d00: missing native rules. Candidate118/21frontend
PASS3.95s; build/lint/types/style/audit pass; existing27warnings,bundle warning and
2moderate/nohighcritical remain. Actual GREEN PRICE-UI/PRICE-RECOVERY1/1PASS16.7s,
realHTTPS/password/MFA/backend/PG22migrations, one worker/zero retries. Original exact
100/110, identical retry/receipt, accepted-refresh lock, late selection, void/history,
accounting/provider/admission assertions retained. New native keyboard/focus/close and
115draft preservation pass. Independent source/oracle plus18header/book/history frame
review and separate6editor frame review found no blockers. Runtime live-origin focus;
disconnected/disabled fallback source-reviewed only. Native select popup readability,
all error-state visuals and whole-product accessibility are not established.
FEsha256:0ffbe36b31fa94fe3a8e931b2f6bdd4e53f2065916d12069ffb75245d6a26c3f;
unchangedBEdd90a8c5. Logs/artifacts `/private/tmp/capital-price-workbench-*`.
Archived as2026-09-27-redesign-manual-price-workbench:3newrequirement blocks match,
40previouscanonical files remain byte-identical, strict41canonical specs pass and
active changes are empty. Product/archive dc5aada fast-forward integrated; all6tasks
complete. Seven exact temporary dependency links unlinked; primary dependencies and
all source worktrees retained. Owner Nginx/lock, preview image/volume and stopped
containers remain preserved; no disposable E2E resources remain.

## Settings workbench — 2026-09-27

`redesign-settings-workbench` follows628581c. RootTSX8bbc194, LunaCSS5f31f98
integrated7d1d4a0 and rootfollowup6a65642 add named native section selection, associated
language/theme labels, exact amount guidance, separate stored-read/collect actions and
result-before-metadata evidence. Fourteen control signatures plus module/pre-render
logic remain structurally unchanged; reviewer separately checked original FX types
and conditional mounting. Unused invitation-code CSS removed after consumer search.
No backend/API/auth/schema/dependency/pipeline changes. Soltestse9b23c83/8a6fb431
integrated607a992/cc632da; latter corrects no-refetch observation to cover500ms afterclick.

Actual predecessor RED onFE0ffbe36b: missing named Settings group. Candidate118/21
frontendPASS5.33s; build1.06s/lint/types/Biome7/audit pass; existing27warnings,bundle
warning and2moderate/nohighcritical remain. Actual GREEN DFX-UI1/1PASS17.9s, one worker/
zero retries, realHTTPS/password/MFA/backend/PG22migrations. Exact123.45→111.105/11125.314,
lateamount rejection, failedcollection last-good200→180/18024, financialfingerprints
and exactly2provider calls preserved. Generalcontrols/keyboardselection, noFXbefore
activation, repeatedactivebutton no-refetch and theme/viewport assertions pass.
FEsha256:9f53b3f46a042d5759c91956e86295563186c0124826f34bc7b8230e30279571;
unchangedBEdd90a8c5. Logs/artifacts `/private/tmp/capital-settings-workbench-*`.
Actual18frames:6general/12FX atlight/dark360/768/1440. Independent source/oracle/FXreview
and separate generalproductvisualreview have no blocking findings. Captures cover normal
preferences/freshconversion, not every error-state or a complete accessibility audit.
Archived as2026-09-27-redesign-settings-workbench:3newrequirement blocks match,
41previouscanonical files remain byte-identical; strict42canonical specs pass and active
changes empty. Product/archive d69ea20 fast-forward integrated; all6tasks complete.
Seven exact temporary dependency links unlinked; primary dependencies/sourceworktrees
retained. Owner Nginx/lock, preview image/volume/stoppedcontainers preserved; no E2E
resources remain.

## Acquisition review focus — 2026-09-27

`focus-acquisition-review` follows2616db4. Acceptancefe5f713/e81ecd8 preceded product:
both predecessor9f53b3f4 real journeys failed expected10s oldcorrectionopener focus.
RootSwaps/CSSfcd3e00, LunaRewards92f9f2c→15d0ba2, rootconsistencyf18a1c7 add explicit
postcommit editor/history focus, cancel/close return and late-history invalidation.
Original controller/reset prefixes and19control/form/pagination signatures retained.
Independent review closed an undefined focus-color token; source/oracle and all19new
360dark/1440light frames pass review. Minor outline/record-count spacing remains
nonblocking for whole-screen polish. Detached-origin fallback/pagination source-reviewed.
Final118frontend/21files PASS3.65s; build1.07s,lint27existingwarnings,strictE2Etypes,
Biome/audit2moderate/nohighcritical/strict43activeitems pass. RealGREEN3/3 in52.1s:
WORKFLOW16.0s/REWARD17.5s/SWAP18.0s, actualHTTPS/password/MFA/PostgreSQL22migrations and
artifact/proxy checks; onlyexternalprovidersfixtures. FEeedaddee6de4eb8719c7fe19d09400716a0d96ea994bef525c426ad99788a810,
BEdd90a8c5 unchanged. Evidence `/private/tmp/capital-acquisition-focus-*`.
No fullsuite/liveproviders/security/release/previewrollout. E2Eresourcesempty; preview
stopped45h with originalimage/volume intact. Archived2026-09-27-focus-acquisition-review:
41othercanonicalfiles byte-identical,3oldrequirements preserved,2newblocks match;
strict42canonical specs pass/noactivechanges. Archive/product60c28d8 fast-forward
integrated; all6tasks complete. Exactly7temporarydependencylinks unlinked; primary
dependencies and allsourceworktrees retained. Owner Nginx/lock unchanged.

## Merged worktree cleanup — 2026-09-27

Owner explicitly requested removal now. Luna inventory and independent review covered
108registered worktrees. Root removed101 using non-force git worktree remove after
ancestry(19)/patch-equivalence(82), immediate HEAD/status, exact dependency-link and
generated-artifact/synthetic-runtime guards. Branches retained;101paths absent verified.
Followup exact proof resolved the3exceptions and they were also removed (104total);
after verified analytics integration its3trees were removed too (107total). Only main
remains registered; all104named branches retained and3detached review HEADs ancestral.
No unique working edits, original
repositories, primary dependencies or preview resources removed. Full record and
exceptions: docs/worktree-cleanup.md. Evidence /private/tmp/capital-merged-worktrees-*.

## Account analytics — archived and integrated

`redesign-account-analytics` basec3a4dbd introduces a labeled native task selector:
valuation initially, sampled history and accounting positions. Original owners stay
mounted; drafts/results/retry identity survive switching without requests. Associated
UTC/price/sampling help, native method disclosure, exact-result-first hierarchy and
named keyboard-scroll tables preserve every original financial/provenance distinction.
Rootcompositionfc7c389/9a5c82a, LunaCSS7039fc4, readability6c06299, Solacceptance
992afd3→ebfa44b and corrections628f847/ab357f5→db77ca5/47c78f5. Fourcontrollers,
27protected signatures and chart transforms/options remain unchanged;30daybound kept.

Real predecessor RED reached intended old-panel-visible failure before product edits.
First GREEN3/5 found native Mac popup keyboard automation and setup-call-budget issues.
Corrected trusted Russian type-ahead input and actualPG bulk catalogue-only fixture;
all originalfinancial/quota/admission oracles retained. Account/opening/carry/trade
commands remain real API. Dark-chart contrast finding fixed with a light plot surface.
Final five real WORKSPACE/HISTlate/HISTpinned/VAL/VCH journeys PASS1.2m,1worker0retries.
Frontend118/21PASS4.04s, build/lint/types/style/audit/strict43items PASS. Existing27lint/
bundle warnings and2moderate advisories remain. Full suites/release/security unrun.
Separate review approved source/oracles and all38final themed360/768/1440frames.
Evidence and limits: archived2026-09-27-redesign-account-analytics verification/review.md;
no owner UX approval. Archive comparison:42old specs byte-identical,3new blocks exact;
43canonical specs, no active changes. Integrated2f9ba1f; last3worktrees removed after
guards, all6tasks complete. See docs/worktree-cleanup.md for107total removal evidence.

Accepted FEsha256:6ee61c50a0ea62d6e6542bd794a3de444312edd39ac2c3d6fc0114f8863aa479;
unchanged BEsha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2.
Logs/artifacts `/private/tmp/capital-analytics-workbench-*`. E2Econtainers/networks empty;
preview remains stopped46hours, original volume/tag/MFA/TLS/credentials preserved.
Owner Nginx/lock hashes unchanged. Only the primary checkout remains registered;
all named source branches retained. No preview/production deployment.

## Verified currency visibility — 2026-09-27

`redesign-currency-visibility`, base1fd044f, product87cf954: recoverable paired stored
lists, explicit hide/show with the required DTO flags, serialized requests across
remount, last-good failure state, identity disclosures and scoped responsive tables.
Genuine preproduct RED confirmed the missing inline error after actual response loss.
First GREEN failed on old missing isHidden and changed scope copy; both corrected
without weakening backend validation or retained DFX assertions. See verification.

Final real CVIS/DFX2/2 PASS37.7s,1worker0retries through HTTPS/password/MFA/backend/PG.
FE7190d650fb98b2d77ad5e79272fccf6cb5e790ea8dcee355fca9d97ad9682a36;
BEdd90a8c5 unchanged. All36light/dark360/768/1440frames independently reviewed and
approved with final source. Frontend121/22PASS3.95s, corrected API/coordinator9/9PASS,
build/lint/types/scopedBiome/strict44items and dependency gate pass. Existing27lint/
bundle/http2 warnings and2moderate advisories remain; no high/critical dependency finding.
No full-suite, release, owner UX approval or preview deployment claim.

Archived as2026-09-27-redesign-currency-visibility:43old specs byte-identical,3new
blocks match,44strict canonical specs pass, no active change. Archive c7a8090 was fast-forward integrated. All three completed currency worktrees
were removed without force; all six change tasks are complete. Aggregate110paths are
absent,107named branch HEADs retained,3detached reviewHEADs ancestral. Only main remains
registered at this checkpoint. Main Nginx/lock hashes remain
unchanged; preview remains stopped with its original image, files and durable volume.
No backend/schema/auth/provider/deployment change. Whole frontend and target remain open.

## Next work and remaining whole goal

Continue complete frontend/UX redesign in docs/frontend-redesign-plan.md. FUI-01/02/03
are partial; FUI-04 has its first bounded period-review slice and remains partial;
FUI-05 has its first Settings slice and remains partial; FUI-06 and owner visual
approval remain open. Next coherent workflow: integration-health/legacy screens and remaining whole-screen
UX findings, then broader portfolio/allocation/cash work. The bounded account-analysis
slice is archived and integrated. Legacy routes remain subordinate;
Settings visibility is not integration health or complete accounting.
Compact context and trade entry/focus are complete.
Carry the focus convention into other editors; track delayed create completion and
focused desktop-navigation collapse on resize as nonblocking UX review followups.
Keep chart/max-period expansion deferred for the owner's later review.

Planning estimate reviewed against the remaining whole target on2026-09-27: roughly
32–50 small OpenSpec changes including optional AI, not a fixed backlog or percentage.
Existing-screen UX4–7; whole-portfolio analytics4–6; automatic prices/history/FX4–6;
six networks plus shared synchronization/reconciliation/import12–18; AI2–3; security/
release/restore5–8; final consolidation1–2. UI for new features is counted in its feature
block, not again in frontend. Provider feasibility and discovered defects can change it.

Still required: broader import/automatic reward and chain reconciliation; automatic
prices/retention/history; whole-portfolio allocation/cash UI; six network adapters with
honest coverage; optional AI; release/security/backup-restore hardening and consolidation.
Selected manual valuation is not complete all-account/cash accounting. CoinGecko
permanent history retention remains unapproved. Accounting locks have no dedicated
transaction-local timeout; track explicit policy/held-lock refusal/reusable-key tests
as shared release hardening. Current race tests prove serialization, not bounded waits.
Instrument receipt labels currently depend on the create/read-only catalog remaining
immutable; future catalog edits require explicit receipt preservation.

At the pre-resume whole-goal checkpoint, preview updates, owner DB access, production
rollout, remote push and project cleanup were out of scope; the resumed manual MVP
authorization above governs its release path. Preserve preview volume/MFA/TLS/credentials,
old image tag7eff01d1 and stopped containers.
Retain active/unproven worktrees; remove proven integrated worktrees after guarded
verification as now authorized. Root alone owns Docker, migrations, locks and
deployment; protect owner Nginx/lock hashes above. Follow worktree/model-routing rules
for the next independent tasks; prior quota errors are historical, not a current blocker.
