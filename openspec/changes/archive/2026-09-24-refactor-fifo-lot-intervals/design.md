## Context

The target requires owned transfers and reproducible correction of old history.
Current FIFO has original quantity/cost plus disposed/allocated counters; it already
uses difference-of-cumulative-cost allocation. Carry-in preserves that original
phase. Reusing a remainder as a new lot would change rounding, especially for
one-atom costs. Existing240 tests/7suites passed at58100f9 before changes.

## Goals / Non-Goals

**Goals:** one small exact interval primitive used by current FIFO; passing public
characterization; explicit partition/split/carry-in invariants for transfer reuse.
**Non-goals:** transfer API/storage/UI, connected replay, cash, fee policy, provider,
new schema/dependency, charts, production or original-folder consolidation.

## Decisions

- Add `fifo-lot-interval.ts` with readonly `LotInterval` fields originalQuantity,
  originalCost,start,end, all BigInt atomic units. Bounds: Q>0,C>=0,0<=start<=end<=Q.
  Empty remainders are valid. Factory `lotInterval(Q,C,start=0n,end=Q)` validates;
  `intervalCost(interval)` is floor(C*end/Q)-floor(C*start/Q), never rebased.
  `takePrefix(interval, quantity)` requires0<quantity<=end-start and returns new
  `{taken,remainder}` intervals preserving Q/C and original coordinates.
- Validate bounds at public helper boundaries; do not mutate supplied intervals.
  Keep existing FifoHistoryError name/instance identity through a re-export from
  fifo.ts if its definition moves to the helper; avoid circular imports.
- WorkingLot stores its source metadata plus remaining interval, removing redundant
  disposed/allocated counters. Buy starts[0,Q); carry-in starts[Q-carried,Q).
  Derive carry-in's old priorDisposed/priorAllocated/carried fields from the same
  interval. Source trade/carry-in DTOs, FIFO order, caps and all summaries unchanged.
- Keep acquisition/event sorting outside the scalar helper. It has no account,
  transfer, price or database identity and does not claim to implement movement.
- Preserve existing characterization rather than manufacture RED. New helper
  tests supplement it: Q7/C11 partition costs4/2/5, split1+1+1 vs3 equality,
  all small integer partitions, full precision bounds and invalid ranges.

## Risks / Trade-offs

Extra BigInt divisions in projection are bounded by existing1000trades/100initial
lots; actual maximum-fixture PostgreSQL tests remain the check, with timings only
observations. No changes to queue ordering or error mapping are allowed.

No migration/data conversion; source revert is sufficient rollback. Pipeline kept.
Selected verification: existing240tests + interval unit oracles, backend lint/build,
production dependency gate, strict specs; unchanged realPG usd-trades-db/carry-in-db
and two HTTPS cases TRADE-003-A / TRADE-006-A (Russian trade journey) and CARRY-004-A
(CSV carry-in/correction/rollback). No new E2E, frontend rebuild or unrelated fullrun.

## Next dependency: owned transfers

This prerequisite does not replace the pending transfer requirement. Next design
must use immutable transfer commands and dynamic connected-account replay, preserving
origin identity and intervals through repeated/roundtrip transfers. Arrival makes a
fragment available only at that time, ordered thereafter by original acquisition.
Old trade/CSV corrections must re-evaluate dependent holdings, not permanently freeze
history. Lock owner before account rows in all economic writers, and invalidate
recipient pinned views after upstream edits. Explicitly separate journal revision
from number of local trade versions. Consume a declared fee asset from source once,
with transparent basis/valuation treatment. No invented buy/sell or external flow.
