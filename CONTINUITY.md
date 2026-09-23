# Capital Tracker refactor continuity

## Goal and boundaries

Continue the full incremental refactor against capital-tracker-openspec-prompt.md.
The full goal is NOT complete. Preserve owner data and unrelated edits. No paid
services, production deployment, remote push or original-folder deletion occurred.
After the whole verified refactor, consolidate into capital-tracker-old and remove
only confirmed related duplicates under docs/consolidation-plan.md, preserving
history/configuration/user data first. Do not consolidate an incomplete slice.

Branch: refactor/brownfield-baseline. Root owns migrations, lockfiles, shared fixtures,
deployment and Docker. Use independent worktrees and reviewed integration; route
simple tasks to simpler models where supported. Keep code maintainable and provide
short periodic Russian updates. Future-work preferences are already saved in memory.
New agent spawning hit the platform thread limit; reuse audit_security,
gate_acceptance and provider_feasibility. All worktrees remain retained.

Preserve unstaged frontend/nginx.conf: SHA256
115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432,
mode0644, size1348. Current lock SHA256:
13e4fbf1d1effcf66367ef7829885eb53b339cb9f52ab43854ca2e4ba77c4e73.

## Runtime and workflow

Project pins: Node22.21.1, pnpm10.33.0, OpenSpec1.2.0, Playwright1.63.0.
PG16.10, Docker29.5.3/Compose5.5.1. During the final USD run an external host update
removed Node22.21.1 and changed global pnpm to12.5.1. The running gate completed.
For NEW local commands use:
PATH=/private/tmp/capital-task-bin:/Users/pavelars/.nvm/versions/node/v22.23.2/bin:$PATH
The temporary pnpm wrapper invokes verified cached10.33.0 directly. Node22.23.2 is
within package engines. Do not change repository pins or global settings for this.
A global pnpm OpenSpec status attempt hung and was interrupted130; the local CLI passed.

OpenSpec actual commands: new change, status/instructions --change NAME --json,
validate --all --strict --no-interactive, archive NAME --yes. No verify command or
validate --change. Use installed propose/apply/archive skills; equivalent verification
is documented. Canonical specs describe implemented verified behavior. New behavior
needs actual acceptance RED; pure refactors retain passing characterization.

Root alone runs synthetic capital-tracker-e2e using tests/e2e/compose.yml, PG tmpfs.
Never production Compose or an owner DB. Docker/registry escalations were approved;
none rejected. Use caffeinate -is for long macOS runs; it is not a closed-lid guarantee.
No Docker run is active now. Only external providers are stubbed.

## Completed and archived

Eleven slices: audit/baseline, isolated release acceptance, CLI owner, opaque sessions,
checkout preservation, mandatory MFA, dependency remediation, trusted client source,
persisted auth request limits, exact manual openings and exact USD FIFO trades.
Manual archive: 2026-09-23-record-manual-opening-positions (e2080aa), full85 GREEN.
Latest actual archive: 2026-09-23-record-usd-fifo-trades; six added requirements,
two modified, none removed. Complete history/evidence is in its verification.md.

USD product source verified at62e8f26; later changes are docs/spec sync and preserved
owner Nginx. Explicit attested empty origin, no opening-history conversion, exact
scale30 BigInt FIFO, full immutable corrections/terminal voids, replay-before-CAS,
1000 active/10000 version caps, coherent read-only RR and protected Russian UI.
Migration14 adds three empty journal tables and preserves predecessors. Read archived
persistence.md and canonical usd-fifo-trades before changing contracts.

Actual genuine predecessor HTTP/UI RED preceded implementation. Independent reviews
found/fixed refresh rebase and lost-response replay defects, including a real CSRF403
retry; four retained UI regressions now pass. Historical failure logs and all oracle
repairs are honestly recorded in archived verification; never weaken them.

Final source gate: /private/tmp/capital-usd-final-source-gates.log exit0, strict11,
backend/frontend lint/build,737 backend tests/24 suites,81 frontend tests/10 files,
183 engineering tests/2 suites included in737 and also separately invoked.
Frozen install/high-threshold live audit exit0;2 moderate Router advisories remain,
0 high/critical. Existing77/29 lint warnings and bundle warning remain documented.
Focused16: /private/tmp/capital-usd-focused-final.log exit0,4.0m,1worker0retries.
Full gate: caffeinate -is pnpm test:e2e, session21411 FINISHED exit0,
/private/tmp/capital-usd-release-full.log:101/101 Chromium,21.7m,1worker0retries,
plus all actual provider TLS, migration, PG/CLI/MFA/session/admission,27 startup
refusals, topology/artifact and checkout-preservation prerequisites.
Backend sha256:17283e22fdc410782a31ebdd86e627e8c07cb576fd1f0b82ffb9bc87e39fc2c3.
Frontend sha256:ebf4d8ce70cd660fc854459c6c84519fec7d54ab087a8019fc8f37f57a6234ad.
Owned cleanup completed; independent Docker reads empty; owner Nginx/lock unchanged.
Hosted CI, second browser, image/SAST/DAST/full ASVS and backup/restore remain unrun.

## Now and next

USD archive and documentation committed97a7a2d; strict11/diff passed. Actual-label
Docker checks found no owned Compose or client-source probes. New active change
import-usd-trades-csv: proposalcd6ec20; independently reviewed design/persistence/parser
decision integratedeafe9c0. Actual CLI artifact instructions/status/apply used;
all artifacts ready, strict12 passed,2/28 tasks complete (predecessor and design review).
Final scenarios/API/schema/UI labels are frozen for independent test authorship.
No CSV product/schema/dependency implementation has begun. Full authorization
covers ordinary incremental implementation; no extra user approval is needed.

Independent temporary design inputs under /private/tmp:
- capital-csv-next-contract.md: initial memo, superseded where refinements differ.
- capital-csv-contract-root.md and capital-csv-proposal.md: coordinator decisions.
- capital-csv-acceptance-review.md: concrete independent acceptance matrix.
- capital-csv-security-review.md: transaction and security review.
- capital-csv-parser-decision.md: official csv-parse7.0.2 MIT/CJS/no-runtime-deps and
  actual installed Nest/Multer upload research; runtime parser proof still pending.
- capital-csv-persistence-contract.md: exact DTO/three-table/canonical tuple freeze.
Final artifacts in openspec/changes/import-usd-trades-csv supersede these temporary
memos. Additional capital-csv-test-plan.md maps independent unit/PG/HTTPS ownership.
New worktrees csv-design (design committed), csv-acceptance (QA), csv-backend (reserved).
Next: maintained2-case real predecessor-image RED, independent parser tests, then
bounded implementation. Root alone runs Docker and must check exact predecessor IDs.

CSV scope: UTF8 up to256KiB/100rows, inspect before mapping, explicit owned UUID/USD/
decimal/time/order/fee settings, preview errors, whole-batch atomic confirmation,
private original/provenance and conditional atomic rollback. Preserve1000/10000caps.
No implicit origin/carry-in or semantic dedup of changed/overlapping exports. Replayed
accepted commands precede reparse/parser support/live state. Version usd-csv-v1 is
explicit. Rows pin batchState; detail live rollbackReview uses coherent RR. Valid
rollback reallocation is allowed when every remaining prefix holds; show before/after.
Parser/transport choices need actual source/HTTP proof. Root owns dependency/migration15.
New genuine CSV RED must execute against exact verified USD images before behavior.

Remaining full goal after CSV: carry-in/owned transfers/flows, performance XIRR/TWR,
DB-first price/FX/history, six-chain adapters/reconciliation, explicit optional free
AI, immutable promotion/security/backup restore, final requirements audit, consolidation.
