## Why

The verified USD journal records exact trades individually, but the owner's Excel
history cannot yet enter that model through a reviewed, repeatable import. A bounded
CSV journey should preserve original evidence and legitimate duplicate-looking rows
while preventing repeated acceptance of the same file and partial accounting writes.

## What Changes

- Retain one private UTF-8 original per exact file/account identity, with bounded
  source inspection before column and owned-instrument mapping.
- Preview explicit decimal/time-zone/USD interpretation, every row error, ignored
  columns and exact before/after recorded-cost results; never guess missing fees,
  acquisition history, instrument identity or execution order.
- Confirm up to 100 rows atomically against the complete existing chronological
  journal under its account lock, revision check and unchanged 1000/10000 caps.
- Record batch/source-row/version provenance and immutable command receipts;
  repeated accepted commands return their original receipt before mutable checks.
- Offer reviewed conditional rollback by appending all batch void versions in one
  transaction, preserving originals/history and refusing changed imported heads or
  an invalid remaining chronological history. Recompute remaining valid FIFO matches.
- Add a protected Russian upload/inspect/map/preview/confirm/history/rollback journey
  and independent real PostgreSQL/HTTPS acceptance, including uncertain responses.

Non-goals: XLS/XLSX, implicit empty origin, carry-in lots, opening conversion, semantic
deduplication of changed/overlapping exports, blockchain reconciliation, swaps,
non-USD fees, cash flows, valuations, investment returns, provider calls, paid services,
production rollout or original-repository consolidation.

## Capabilities

### New Capabilities

- `usd-csv-imports`: Private bounded originals, explicit interpretation, whole-batch
  atomic acceptance, inspectable immutable provenance and conditional safe rollback.

### Modified Capabilities

- `usd-fifo-trades`: A batch may append N consecutive version ordinals in one commit;
  current revision advances atomically by N. Preserve every existing single-command
  contract, exact arithmetic, full-history validation, read isolation and hard cap.
- `explicit-migrations`: Add a data-preserving fifteenth migration and rehearse
  populated fourteen-to-fifteen upgrade, fresh installation and all prior refusals.

## Impact

One pinned backend CSV parser dependency, narrow strict format/upload adapters and
an import service inside the existing accounting module. Share a caller-owned
transaction persistence seam with TradeService instead of looping public commands.
Add three empty import tables with composite RESTRICT provenance references, bounded
private API/UI and independent parser/PG/browser tests. Root owns dependency/lock,
migration, shared fixture and deployment-template changes; preserve the owner's
unrelated frontend/nginx.conf and every existing row.

Implementation depends on verified archive of `record-usd-fifo-trades` and genuine
missing-route/UI acceptance RED on those exact predecessor release images. The
existing source/PG/HTTPS tests characterize the ledger extraction; no artificial
failure is required for that pure refactor. This importer deliberately stays inside
the journal's existing limits instead of claiming large-history support.
