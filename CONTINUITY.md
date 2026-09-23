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

## Completed slices and evidence

Historical accounting, external flows, manual profit and conventional XIRR are
archived under openspec/changes/archive/2026-09-23-*. XIRR archive92a3039 has17
canonical specs;139 pure cases and4 targeted HTTPS passed. Earlier full133 suite
passed at carry-in; historical full140 attempt was stopped per user, never GREEN.
Manual profit/XIRR use reviewed valuations and effective owner flows; no automatic
valuation. Use archive verification.md files for exact old results and image IDs.

## Current manual USD price slice

record-manual-usd-prices implemented, independently reviewed, scoped GREEN;
archived2026-09-23-record-manual-usd-prices,9/9tasks. Strict18canonical specs pass,
activechangesempty, prior17specs unchanged. Contractcdde4d8,
acceptance8b6dd1c/ad96a36, backend978247d,
UIac9f408, root history-access fixb01bced, final strengthened acceptanceb00a1cc.
Guide docs/manual-usd-prices.md; evidence
openspec/changes/archive/2026-09-23-record-manual-usd-prices/verification.md.

Additive migration1790080000000 (current18), one manual_usd_price_versions table.
Per-owner/instrument UUID book, exact USD/unit price strings48int/30frac, canonical
UTCms1970..9999. Append-only set/void,10000version cap, READ COMMITTED owned
instrument lock before replay/CAS. Original receipt replay before stale/cap check.
Set/correct/void/restore preserve old rows; zero is explicit, missing stays absent.
RR READ ONLY effective pages pin currentRevision, immutable per-instant history.
No providers, currency mapping, interpolation, automatic valuations or new deps.
Protected /manual-prices UI: paged instrument catalog, review on save/void, history
including excluded points by timestamp, exact unknown-outcome request retry,
successful-save/failed-refresh distinction, stale selection/auth guards.

Root backend/migration/PG/shared runner; Luna two browser cases in prices-acceptance
worktree, Sol UI in prices-ui worktree and independent backend review: no blocker.
Root independently reviewed UI and corrected type/history access; Luna PG test
review added persisted state assertions after races. Worktree symlinks removed.

Actual predecessor RED: pendingMFA expected401 got404; missing newUIheading.
2failed, exit1, real previous images verified before product edits; log
/private/tmp/capital-prices-predecessor-red.log. No missing-module RED claim.

488 unit cases/10 suites (55new+433retained),2.743s; backend build/lint pass with77
existing warnings. Main frontend build/lint pass with29existing warnings andbundle
warning; Sol95Vitest/10files pass. Scoped E2E strictTS pass. Auditproduction exit0,
2existingmoderateRouter findings, no lock change; logcapital-prices-audit.log.
HostNode22.23.2; images pinned22.21.1. No new dependency/frozen-install cycle.

PG log /private/tmp/capital-prices-db-focused.log exit0:5price families, fresh18,
populated17 upgrade/rerun preserving all oldrows/openingreceipt, actual two-pool
CAS/replay and pausedRR, exactvalues/constraints/cap. Retained migrations.cjs also
passed: config/lock/refusal, fresh/replay, previous8..16 upgrades/schema/session/
MFA preservation. Initial PG failure was helper not catching synchronous400;
442b861 wraps action in async callback, same expected statuses, no productchange.
Initialfailurelog /private/tmp/capital-prices-db-initial-failed.log retained.

HTTPS3/3 in44.7s atb01bced:2prices+retainedOPEN001A/002A. Then strengthened only
PRICE-UI failed-refresh acceptance atb00a1cc:1/1 in13.5s, identical images.
Logs /private/tmp/capital-prices-focused.log andcapital-prices-ui-recovery.log.
Real TLS/password/MFA/app/PostgreSQL, external providers only stubbed; delayed or
aborted response delivery always uses actualroute.fetch first. Images:
BEsha256:16266828034a018b39ec611733c062415da7e5d2001ee19a054385c620fa3dfd
FEsha256:45a1f6056008cddc1162ebb52681475af63863922a673bcff947b79fac08c9db
No fullbackend/fullE2E/hostedCI/release scans/production run. All oldcases retained;
fullrunner includes pricePG fixture, oldcurrentmigration assertions updated to18.

Owner Nginx hash/mode and lock preserved; synthetic containers/networks empty.
Next: small historical valuation from reconstructed holdings and
stored exact-time manual prices, with missing prices visible; don't infer past
holdings from today's balances. Whole brief still needs automatic prices/history/
charts, TWR, transfers/swaps/rewards, blockchain reconciliation, optionalAI and
release/backup-restore hardening before consolidation. No move/delete originals.
Reuse carry_docs_review Luna(simple) and historical_ui Sol(complex/review).
gate_acceptance is quota-limited untilSep29; do not retry/purchase.
