# Verification record

Status: implemented, independently reviewed and targeted verification GREEN on
2026-09-24. This verifies recorded owned-account transfers, not the whole target
brief, production readiness, live providers or a production deployment.

## Contract, implementation and independent review

Reviewed contract0ca5d15 freezes persistence/API, original lot intervals, both-account
coverage, fee basis, graph replay, bounded work, passive revision budgets and paging.
Independent pure acceptance7f87f15/530c8a5 and real PG/HTTPS acceptance20b94ac preceded
product implementation. Backend52cbfa8/a3c5d23 implements migration20, strict commands,
owner-before-account locks and connected trade/CSV/current/historical projections.
Frontend2764a65/39b71d4/a3c5d23/b200e64 supplies protected review/retry/correction/void,
separate immutable receipt/current allocation and explicit original provenance.

Sol reviewed the financial/architecture contract, implemented independent pure
acceptance, then independently reviewed the integrated backend including migration,
CSV, concurrency and snapshots: no unresolved product blocker. Root reviewed all
agent diffs, frontend recovery/metadata and acceptance oracles. Luna reviewed the
browser failure fixes, exact capacity/paging tests and final code/evidence mapping:
no remaining acceptance blocker. Clear worktree/file ownership was retained; root
alone operated Docker and owned migration/dependency/deployment integration.

## Genuine pre-implementation RED

At20b94ac, root ran `/private/tmp/capital-owned-transfer-red.cjs` against the exact
accepted predecessor images without rebuilding product code:

- Backend sha256:f1f480d4a1039aa89b909075d162273697253c755413c680d48bf01c47c09e3a
- Frontend sha256:4dd2bcef305e76c7a1f5e6506b9ee85d90b46ad77fecd6d4a811b8438586c19e

Actual HTTPS/password/MFA/backend/schema19 PostgreSQL, external-provider-only stubs.
Two cases failed as intended: valid POST /accounting/transfers expected201 got404;
Russian transfer heading absent after10s. One worker, zero retries, exit1. Log
`/private/tmp/capital-owned-transfer-red.log`; traces/screenshots in
`/private/tmp/capital-owned-transfer-red-artifacts`. Product edits began only after
inspection of these failures. The preceding pure interval refactor retained its
passing255/8 characterizations rather than manufacturing a RED.

## Executed targeted manifest

| Risk / scenarios | Actual result and executable evidence |
| --- | --- |
| Exact principal/fee basis, original interval atoms, arrival, chains, full replay and bounds; TRANSFER-001/004 | Targeted backend368tests/13suites PASS in2.896s, including14 independent engine cases, exact100000/100001 allocation boundary, wide derived sums, retained FIFO/carry-in/CSV/history/valuation and strict inputs |
| Input and protected owner workflow; TRANSFER-002/005 | Both new real HTTPS cases PASS in28.1s: API finance/restatement/replay/private refusal and Russian review/create/lost-response identical retry/correction/terminal void |
| Connected commands and immutable receipts; TRANSFER-003 | owned-transfers-db.cjs core7families PASS: exact economics, source correction, lifecycle/privacy/graph split, real two-connection RR, connectedCSV preview/rollback/hash invalidation, deferredCOMMIT complete-write witness/rollback/constraints and distinct-process owner-advisory/account-row contention |
| Capacity/replay | Actual owner1000active and10000versions legal boundaries, overflow refusal, correction without consuming identity capacity, replay before caps and dependent account revision exhaustion PASS |
| Wide reads/valuation; TRANSFER-004, HIST/VAL/VCH/MPV | owned-transfers-bounds-db.cjs PASS:1101 distinct positions priced at2 =>2202,10001 held lots and sale matches reachable beyond offset9999, final empty99999 page, raw-head10000 rejection, whole allocation totals, stale dual pins409 and row preservation |
| Shared projections and metadata | Actual selected portfolio has no duplicated principal; selected account metadata unchanged;3-point series omits from-point transferSummary; exactly one component COUNT preflight, one trade materialization and one batched price load per request PASS |
| Retained financial paths | Actual usd-trades-db, csv-import-db, carry-in-db, historical-accounting-db and valuation-history-db PASS; retained chart31point/100carry/1000trade exact oracle observed233ms, not an SLA |
| Schema and data; TRANSFER-006 | Fresh20, populated19→20/no-op/replay/downgrade refusal PASS. Affected populated14/15/16/18→20 upgrades preserve prior rows/schema/session/MFA/receipts;17→20 manual-price upgrade and retained price economics/races/snapshot/bounds PASS |
| Retained HTTPS | TRADE-003-A/TRADE-006-A, CARRY-004-A and HIST-002-B/HIST-004-B all PASS in first selected run; no need to repeat unaffected cases after the two focused fixes |
| Source and dependency gates | Frontend101tests/14files PASS in2.94s; both builds, backend/frontend lints, strict/noUnused E2E TypeScript, syntax/diff checks and strict OpenSpec27items PASS. pnpm audit:production exit0:2moderate, no high/critical. Lock unchanged |

Unit command: `pnpm --dir backend test --runInBand --coverage=false fifo
historical-accounting trade-input csv owned-transfer-input historical-valuation
manual-portfolio-valuation valuation-history`. Frontend: `pnpm --dir frontend test`.
Build/lint use repository commands. Node22.23.2 host wrapper, imageNode22.21.1,
pnpm10.33.0, OpenSpec1.2.0, PostgreSQL16.10, Playwright1.63.0.
Existing warnings remain: backend77, frontend27, Vite bundle>500kB. Lower-severity
advisory record remains in docs/dependency-security.md; no suppression was added.

Backend used unchanged for successful PG/HTTPS:
sha256:01e43db63bc3faf2227f9b383c28da4650124361d38c65f68a451647151b30d3.
Final frontend (focused browser GREEN):
sha256:184462cbef67047af371da2c8ede0577912823db35fdf047f5c35c3aed5c839a.

## Failures inspected and resolved

- Core PG attempt1 passed migration/economics, then a synchronous new service input
  throw escaped Node assert.rejects. Public methods now consistently return rejected
  promises, matching existing service entrypoints. Attempt2 passed all7families.
  HTTP400/404/409 and exact refusal/fingerprint assertions remain unchanged.
- HTTPS attempt1 had3retained passes and2new failures (one worker, zero retries).
  The API test incorrectly compared per-response timestamps. It now validates both
  canonical ISO timestamps and exact stable404 envelope/equality/no reflected owner
  or account identifiers. UI exact native-select label lookup included option text;
  explicit visible span/aria-labelledby fixes the accessible name. Selectors, amounts,
  retry identity and privacy oracles were not relaxed. Luna independently inspected
  traces/fixes. Only the two affected cases were repeated:2/2 pass,28.1s.
- Retained chart initially counted the mandatory component COUNT query as a second
  history load. The corrected oracle requires exactly one COUNT AND exactly one
  materialization (plus once-only journal/baseline/price reads). Focused chart rerun
  passed all families and exact31-point amounts.
- Static inspection found old upgrade fixtures constructing prior-schema histories
  with current services that now require migration20. bbe99ee uses schema-valid native
  SQL to construct frozen predecessor rows; all post-upgrade verification still calls
  real current services and preserves the old90/60, CSV and carry-in75/25/225 oracles.
  No fake backend, absent-table production fallback or premature new table was added.
  The affected14/15/16/18 matrix and17price upgrade were actually run successfully.

The additional cap/paging/series fixtures extend acceptance after the original
pre-product RED; they are not described as additional pre-product failing runs.

## Evidence and limits

Logs under `/private/tmp/capital-owned-transfer-`:
`integrated-unit.log`, `frontend-unit.log`, `backend-lint.log`, `frontend-lint.log`,
`frontend-build.log`, `e2e-ts.log`, `spec-validation.log`, `audit.log`,
`db-attempt1.log`, `db-attempt2.log`, `retained-db-attempt1.log`,
`bounds-db-attempt1.log`, `upgrade-db-attempt1.log`, `green-attempt1.log`,
`green-attempt2.log`. Backend host build logs use `capital-transfer-*-build.log`.
Failed first GREEN browser artifacts: `capital-owned-transfer-green-artifacts`;
focused final run: `capital-owned-transfer-green-attempt2-artifacts`.

Root harnesses `capital-owned-transfer-{db,retained-db,bounds-db,upgrade-db,green,
green-focused}.cjs` use only the guarded synthetic Compose project and PostgreSQL
storage in memory. Artifact/network checks pass; every runner has finally cleanup.
Final live labeled Docker container/network inventories are empty.

Owner Nginx bytes/mode preserved:0644,size1348,
SHA256115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432.
Lock SHA2566a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d.
No owner database, production deployment, paid service, remote push or folder deletion.
Full backend/E2E, older8–13 upgrade matrix, hostedCI, full security/image scans and
release/backup/restore validation were not run this slice. Existing tests/CI retained;
full runner now includes both transfer PG fixtures. The full project brief remains
incomplete, including swaps/rewards, automatic prices/history, blockchain reconciliation,
whole-portfolio/cash, optionalAI, release hardening and final consolidation.

## Archive and final consistency

Installed OpenSpec1.2.0 `archive record-owned-transfers --yes` succeeded and created
`2026-09-24-record-owned-transfers`. Its9/10 progress warning referred only to task4.2,
which includes the archive operation and post-archive checks themselves; implementation
and all required runtime gates were complete before this command. The CLI also emitted
the nonblocking recommendation to split more than10 deltas. No requirement was removed.

Post-archive strict validation:27canonical specs passed,0failed; `openspec list --json`
returned an empty changes array. Exact requirement-block comparison found6added and
19modified blocks matching their archived deltas, after normalizing repeated blank lines.
The initial byte-substring probe failed only on a duplicate blank line in TRADE-005;
no text or scenario differed. All14untouched requirement blocks within changed specs
were preserved, and the other19canonical spec files were byte-identical to saved
pre-archive SHA256 hashes. A separate Luna review confirmed no substantive mismatch
or lost prior scenario. Replaced the CLI-generated Purpose placeholder with the real
capability purpose. Removed CLI-added trailing blank lines to pass `git diff --check`.

Final owner Nginx content/mode/size and lock hashes match the preserved values above.
Actual Docker container and network queries for the isolated Compose project both
returned empty inventories. No further runtime code changed after the recorded passes.
Task4.2 is complete; all10tasks checked. CONTINUITY.md now summarizes the completed
slice and explicitly retains the much larger unfinished whole-project scope.
Archive log: `/private/tmp/capital-owned-transfer-archive.log`; post-archive validation:
`/private/tmp/capital-owned-transfer-postarchive-validation.log`.
