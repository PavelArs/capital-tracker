# Verification record

Status: contract/acceptance preparation. No transfer implementation or behavioral
RED/GREEN yet. This record distinguishes planned gates from executed evidence.

## Accepted predecessor

Main a4ffd3a includes archived FIFO interval refactor6532faa. Only owner's unrelated
frontend/nginx.conf is modified at start. Previous pure refactor targeted255tests/8
suites, actual PostgreSQL trade/carry-in families and2retained HTTPS cases passed;
see archived2026-09-24-refactor-fifo-lot-intervals/verification.md, not a claim that
new transfer behavior exists. Do not rebuild these predecessor images before RED:

- Backend sha256:f1f480d4a1039aa89b909075d162273697253c755413c680d48bf01c47c09e3a
- Frontend sha256:4dd2bcef305e76c7a1f5e6506b9ee85d90b46ad77fecd6d4a811b8438586c19e

## Review and ownership

Sol independently reviewed drafta4ffd3a: numerical oracles consistent; required
both-account coverage, unambiguous consumed fee basis and bounded allocation pages.
Root incorporated those findings in persistence.md/specs. Follow-up review found
existing TradeResults discriminant/fragment-key handling and series metadata spread
risks; explicit integration requirements now cover both, plus derived paging beyond
9999 and a separate held-fragment cap. Luna drafts modified
capability deltas in a separate worktree; Sol authors independent pure acceptance.
Root owns migrations, Docker, shared runners and integration. No production access.

## Executed contract/pre-implementation checks

- Root strict installed OpenSpec `validate --all --strict --no-interactive`:27/27
  items pass; log `/private/tmp/capital-owned-transfer-contract-validation.log`.
- Sol independent pure tests68daaa3/f802a34 integrated7f87f15/530c8a5;14 cases,
  exact100000/100001 match boundary, wide sums and independent numeric oracles.
  Agent scoped Biome/diff check passed; engine absent, tests not behaviorally run.
- Luna seven delta specs fdeed51 integrated5f36032; root reviewed and restored
  unchanged canonical scenario prose. Root corrected two unreachable paging examples
  to1101 distinct positions and10001 per-sale matches before implementation.
- Root PostgreSQL acceptance first three families drafted; `node --check` and
  `git diff --check` pass. No database execution yet; CSV/race/constraint/migration
  acceptance still pending. No claim that planned gates below already passed.

## Required targeted manifest (not yet executed for this change)

| Risk / scenarios | Executable evidence |
| --- | --- |
| Exact transfer/fee basis, rounding phase, arrival, chains, bounded work; TRANSFER-001/004 | New backend owned-transfer-fifo.spec.ts; retained fifo/fifo-lot-interval/historical-accounting |
| Input/private paging/command identity; TRANSFER-002/004 | New input/service unit checks and two HTTPS cases |
| Real atomic commands, old trade/CSV edits, passive pins/caps, graph splits, replay/commit/races; TRANSFER-003 | New tests/e2e/owned-transfers-db.cjs with actual PostgreSQL transactions/connections; affected retained usd-trades-db/carry-in-db/usd-csv-db families |
| Snapshot and downstream valuation; TRANSFER-004 + HIST/VAL/VCH/MPV deltas | Actual two-connection RR barrier and downstream exact values; relevant lower-level valuation tests |
| Russian owner journey and ambiguous delivery; TRANSFER-005 | Two tests in tests/e2e/owned-transfers.spec.ts, real HTTPS/password/MFA/backend/PG; only external provider stubs |
| Schema/data preservation; TRANSFER-006 | Fresh20, populated19 upgrade, repeated no-op, composite/check/deferred constraints, downgrade refusal and all-row fingerprints |
| Unchanged critical flows | Retained TRADE-003-A/TRADE-006-A and CARRY-004-A HTTPS, selected after integration according to touched paths |
| Source consistency and production dependencies | Affected backend/frontend tests, build/lint/types, scoped formatter, strict OpenSpec, pnpm audit:production |

No full E2E/backend suite per slice unless a new finding justifies it. Existing
assertions/CI remain. Full release matrix, hosted CI, scans, live providers and
production are not claimed. Actual results and any manifest refinement must be
recorded here before archive; absent test files above are planned work.
