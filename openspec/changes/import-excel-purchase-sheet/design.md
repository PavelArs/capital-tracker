## Context

The owner's sheet (one row per purchase) is the migration source. The existing CSV
import already provides private originals, exact-byte batch identity, preview with
row errors, atomic confirmation, immutable provenance and whole-batch rollback. This
change extends its settings instead of adding a parallel importer.

## Decisions

### Explicit companions instead of defaults
Every relaxation is opt-in and visible in the canonical settings:

| Omitted column | Required companion | Meaning |
| --- | --- | --- |
| side | `mapping.allRowsSide: "buy"`, `sides: []` | every row is a purchase |
| fee | `feeIncludedInGross: true` | fee `0`; cost basis equals the mapped USD total |
| order | `timestampMode: "day-month-year-utc"` | next free orders per date, in file order |

`allRowsSide` accepts only `buy`: the owner has no sales and a sale without a side
column would hide intent. Sales keep the existing explicit side mapping.

### Date boundary
`DD.MM.YYYY` becomes midnight UTC of that calendar date. The owner's sheet has no time
or timezone; midnight UTC is deterministic and independent of the browser and server.
The sheet's calendar date is kept literally (13.06.2025 stays 13 June in UTC), so the
recorded instant may be up to a day earlier than the real purchase time. Journal
coverage must start at or before the first sheet date.

### Order assignment
Without an order column, a row's order is computed from the account's active trades
at that instant (largest order + 1, or 1) plus its rank among the file's rows of the
same date. The result is deterministic for a given journal revision; the preview hash
already binds the journal revision and every normalized execution, so confirm
recomputes and rejects a stale preview. This avoids `duplicate-chronology` when a
day already has trades (for example an earlier file of the same sheet).

### Duplicate guard
Date-only rows lack a time that would otherwise distinguish repeated exports. In this
mode a row identical to an active account trade (all execution fields except order)
is the row error `matches-existing-trade`. The guard does not compare rows inside one
file, so legitimate same-day, same-amount purchases stay distinct. It is limited to the
date mode to keep CSV-001's documented behavior for timestamped files unchanged.

### Canonical encodings stay stable
The canonical command payload and preview hash tuples keep their previous shape: an
omitted column is encoded as `null`, and a trailing `["sheet-v1", allRowsSide|null,
feeIncludedInGross]` element is appended only when an option is used. Stored
`acceptedSettings` of existing batches and replays of old commands are unaffected.
The parser version stays `usd-csv-v1` because existing settings parse identically.

### Reconciliation
A pure module computes, with exact rational arithmetic on bigint, each app value and
whether `|app − sheet| ≤ ½·10^−d` where `d` is the number of decimals the sheet cell
shows: the app value must round to what the sheet displays. Ties count as matches
because Excel rounds binary doubles, so an exact half (780.10005255 shown with seven
places) may display either way. Divisions (`rate`, `returnPercent`) are compared without rounding by
cross-multiplication. Reference columns are query parameters rather than stored
settings: they are only a reading aid and storing them would need a schema change.
The route reads the stored source, accepted settings, provenance links, trade heads
and the latest manual price per instrument in one read-only REPEATABLE READ snapshot.

"Latest manual price" is the newest observation instant whose latest revision is a
`set`. It is labelled with its instant in the UI; it is not a market quote.

### Row limit
The 100-record limit is enforced by `CHECK (ordinal BETWEEN 1 AND 100)` and
`CHECK ("rowCount" BETWEEN 1 AND 100)`. Raising it requires a migration that widens
those checks; it is deferred to a separate change pending the owner's decision and
the merge of the concurrent address-import migration. Until then a longer sheet is
imported as several files; the order assignment and duplicate guard make that safe.

## Risks

- A mistyped sheet date imports on the wrong day; preview shows normalized instants
  and rollback remains available while imported trades are unmodified.
- The duplicate guard can flag a genuine second purchase identical to an existing
  trade imported from another file; putting both in one file avoids it.

## Security and data

No new table, column, migration, dependency or provider call. The new route keeps the
full-session guard, owner scoping and generic 404s, reveals only cells of the owner's
own retained source (already visible through inspection) and writes nothing.
