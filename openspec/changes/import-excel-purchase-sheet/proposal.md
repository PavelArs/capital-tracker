## Why

The owner keeps every crypto purchase in one Excel sheet and wants to move it into
the app without losing anything, then check that the app's numbers match the sheet.
The existing CSV import refuses that sheet as saved from Excel: tab separator, date
without time (`13.06.2025`), no buy/sell column, no fee column, payment in USDT with a
separate USD column, and no same-day order column. The sheet also carries derived
columns (`Курс`, `Текущий курс`, `Текущая стоимость`, `Разница`, `Доход`) that the
app can use as a reconciliation oracle but must not import.

## What Changes

- The existing CSV importer (same routes, tables, batches, preview, confirm and
  rollback) accepts the owner's purchase-sheet layout through explicit settings:
  - tab delimiter in addition to comma and semicolon (inspection and preview);
  - a `day-month-year-utc` date mode: `DD.MM.YYYY` cells become `00:00:00.000Z` of
    that calendar date (midnight UTC, stated in the UI);
  - an omitted side column only with an explicit `allRowsSide: "buy"`;
  - an omitted fee column only with an explicit `feeIncludedInGross: true` (fee 0,
    cost basis equals the mapped USD total);
  - an omitted order column only in the date mode: rows of one date take the next
    free orders after the account's active trades at that instant, in file order.
- USDT-paid purchases import with the sheet's `в USD` column mapped as the gross USD
  total; the payment-currency columns stay ignored source columns.
- Duplicate protection for date-only sheets: a row identical to an active trade
  already in the account (instrument, side, instant, quantity, gross, fee) is a row
  error. Identical bytes still return the original batch. Same-day, same-amount rows
  inside one file remain distinct trades.
- New read-only reconciliation route for a committed batch: for every imported row,
  the app's quantity and cost basis, and the app's buy rate, value, difference and
  return computed at the sheet's own current rate, next to the sheet's cells with an
  explicit match rule; plus the app's unrealized P&L at the latest manual USD price.
- Russian UI: tab option, date mode, optional side/fee/order columns with explicit
  checkboxes, a "purchase sheet" preset that fills the mapping from the owner's
  headers, and a reconciliation table for a committed batch.

## Capabilities

### New Capabilities
- `spreadsheet-purchase-import`: the owner's purchase-sheet interpretation, duplicate
  guard for date-only rows, and batch reconciliation against the sheet's derived columns.

### Modified Capabilities
- `usd-csv-imports`: CSV-002 accepts the tab delimiter and the optional side, fee and
  order columns defined by `spreadsheet-purchase-import`; all other CSV-002 rules,
  and every existing setting, keep their exact meaning and canonical hash form.

## Impact

Depends on `usd-csv-imports`, `usd-fifo-trades`, `csv-workbench` and
`manual-usd-prices`. Backend: `csv-input.ts`, `csv-parser.ts`, `csv-import.service.ts`,
`csv-import.controller.ts`, new pure `csv-reconciliation.ts`. Frontend: CSV API types,
`CsvMapping.tsx`, `CsvImports.tsx`, new `CsvReconciliation.tsx`. Tests: unit suites,
a new real-PostgreSQL probe and one Playwright journey.

Data impact: none. No migration, schema change or new dependency. Settings for
existing batches keep their stored form; the previous canonical command and preview
hash encodings are unchanged for settings that do not use the new options. The
100-record per-file limit stays (it is enforced by database checks); raising it needs
a migration and is deferred to a separate change pending the owner's decision.

Non-goals: sales in the sheet (the owner has none yet), XLSX or UTF-16 files,
exchange integrations, automatic price providers, other spreadsheet layouts,
automatic deduplication of overlapping files beyond the exact-row guard, and
storing the sheet's derived columns.
