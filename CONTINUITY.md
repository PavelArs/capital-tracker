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
aa2588325aacdc54e8437d3500c7d2df580cc20cd061d1e3727f30f0dcc1e4f8. (csv-parse7.0.2 addition)

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
ACTIVE: complete CSV release gate `caffeinate -is pnpm test:e2e`, started at source
2ddfc58, PTY74345; log /private/tmp/capital-csv-release-full.log. Migration/PG and
startup prerequisites passed;124 Chromium cases are running,1worker0retries.
Do not claim final success/archive until terminal exit and cleanup are observed.
Focused runner /private/tmp/capital-csv-http-run.cjs; only external providers are stubbed.

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

CSV change `import-usd-trades-csv`:25/28 tasks checked. Full gate and final archive
remain. Active proposal/design/persistence/specs/tasks/verification contain the exact
contract, complete RED/GREEN history and independent review. Genuine missing API/UI
RED preceded implementation; no assertion was weakened to force success.

Current product source12e718c; full-gate integrated source2ddfc58. Backend image:
sha256:0c239e1e9b2994bd5468bc50ea9ededccf619b44022caf29e84999c18be99e46.
Frontend image:
sha256:e973022048dc5f18608e381d93bcb7a49753efc0653ef37eb04c97164f4fdb4f.
Source gate /private/tmp/capital-csv-final-source-gates.log exit0: strict12,
backend859/26 suites, frontend95/10 files, both lint/build;77/29 retained warnings.
E2E strict TypeScript exit0 /private/tmp/capital-csv-e2e-types.log. Frozen install
and required audit passed;2 existing moderate,0 high/critical. Lock only adds
csv-parse7.0.2. Real PG nine CSV families and all migration upgrades passed.

All23 new CSV cases have passed focused execution and during the ongoing full gate.
Focus logs include capital-csv-final-regressions-2.log (3/3,36.7s),
capital-csv-upload-loss.log (1/1,14.3s), capital-csv-format.log (1/1,13.5s),
capital-csv-literal-and-commands.log (2 commands passed, intended literal RED),
capital-csv-journey-first.log (7 UI passed,2 exact-key-order fixture failures).
Earlier actual401/refresh/new-file/literal RED led to reviewed product fixes.
Later fixture repairs preserved exact financial/security assertions; read verification.

Finish PTY74345/log, inspect terminal count/exit and independent Docker cleanup,
owner Nginx hash and lock/status. If complete124 succeeds, finish3.1/6.2/6.3,
update current docs/evidence, sync full deltas via actual `openspec archive
import-usd-trades-csv --yes`, and strict-validate canonical specs. Preserve every
historical failure and old scenario. No final pass or archive claim before observation.

Next isolated specification: `seed-known-cost-carry-in` in worktree
../capital-tracker-worktrees/carry-in-design, branch refactor/carry-in-design.
CLI-created artifacts,29 tasks and verification manifest; strict13 passed.
Provider contract616cb3f integrated there asd090939; full reviewed artifacts saved
in d3d278e. Worktree clean; no product code or database change.
Audit reviewed shared parser/FIFO-overload/readBaseline seams, schema/provenance;
QA approved independent scenarios; exact Russian locators and all shared seams are frozen. Known-cost current-opening baseline
uses explicit original Q/C/R with cumulative allocation offsets; no inferred lots,
unknown-cost zeroing, fabricated buys or second ledger. Baseline amendment deferred
explicitly to a later required slice, not silently excluded from the whole brief.

After actual CSV archive, reconcile draft deltas against archived canonical specs,
commit/integrate only reviewed artifacts, author independent carry-in API/UI tests
and demonstrate genuine RED against exact CSV images before product changes.
Then parallelize bounded acceptance/backend/frontend worktrees with root sole DDL,
shared fixture and runtime ownership. Preserve exact old empty-origin projections.

Agents: reuse gate_acceptance (QA), audit_security (independent review) and
provider_feasibility (contract/docs; CSV implementation history preserved).
No current agent may run Docker or mutate root shared schema/deployment/lock.
No hosted CI, second browser, backup-restore/release promotion, owner DB or production
operation has been claimed as executed. The full brief remains incomplete.
