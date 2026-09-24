# Capital Tracker refactor continuity

## Goal and limits

Continue the WHOLE target in capital-tracker-openspec-prompt.md. It remains
substantially incomplete. Read AGENTS.md, Git diff and current OpenSpec first.
No paid services, production/owner database access, remote push or folder deletion.
Consolidate into capital-tracker-old only after the whole verified refactor and
inventory in docs/consolidation-plan.md. Original projects/data remain untouched.
The user defers chart/max-period review; current chart remains a bounded 30-day
account series. Legacy Dashboard is not the investment-accounting source of truth.

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

## Completed capabilities

Canonical openspec/specs describe verified behavior; archived changes hold concrete
acceptance, design, persistence and command/image evidence. Do not replay all historical
checks to recover context. Current schema has20 additive/retained migrations; read
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

## Active reward change

record-asset-rewards contract/testseb4c4e0; independent boundarytests787c6ec.
Read active proposal/design/persistence/tasks/verification. Root/independent Sol/Luna
reviewed nullable basis vs income vs price, source-only reward income, unclassified
reward subtype with mandatory economic attestation, connected replay and cost evidence.
No contract blocker. Existing368/13baseline pass2.703s. Root7pure cases fail behaviorally
before product edits; Sol4independent boundary cases also intendedRED. Real HTTPS RED
is pending; do not claim PG/HTTPS GREEN. Root drafted PG economics/lifecycle/populated20
and parser acceptance; additional real concurrency/SQL/RR/cap/CSV fixtures still required.

Fresh worktrees: capital-tracker-reward-core (historical_ui Sol; pure accounting only),
capital-tracker-reward-acceptance (carry_docs_review Luna; two HTTPS cases only).
Root owns migrations/store/service/integration/sharedrunners. Sol may now implement pure core after11actual pureRED cases. Root API/UI/persistence
implementation still waits for corresponding2HTTPS RED; preserve schema20 image IDs.
Logs/private/tmp/capital-rewards-{baseline,pure-red}.log and
/private/tmp/capital-reward-boundaries-red.log. RED harness prepared at
/private/tmp/capital-rewards-red.cjs; image IDs verified live against previous block.

## Remaining whole goal and next work

Still required: swaps and explicitly categorized income/rewards, broader import and
chain reconciliation, automatic price collection/retention/history, integrated whole-
portfolio value/allocation/cash UI, six network adapters and honest coverage, optional
AI, full release/security/backup-restore hardening, final consolidation. Selected
manual valuation is not complete all-account/cash accounting. CoinGecko permanent
history retention remains unapproved; display FX permission does not remove that gate.
No production rollout or folder moves/deletions now. Finish each small change through
review/verification/archive; no broad rewrite. Chart/max-period expansion deferred.

Reusable agents: carry_docs_review (Luna; rendering worktree) and historical_ui (Sol;
transfer-page worktree). Keep their existing worktrees. gate_acceptance is quota-limited
untilSep29; do not retry or purchase credits. Root integrates reviewed commits; agents
do not operate shared Docker/migrations/lockfiles/deployment.
