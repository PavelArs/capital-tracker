## Why

The owner paid for some purchases in RUB and most in USDT, but the CSV import accepts
only USD amounts, so every non-USD purchase must be converted by hand before import
and the original payment is lost. He asked to choose the purchase currency when
importing, not only USD.

## What Changes

- A trade version may record what was actually paid: currency, gross, fee and rate
  (units of the paid currency per 1 USD), in a new table keyed by the trade version.
  No row means paid in USD. Existing tables and rows stay unchanged.
- FIFO, realized and unrealized P&L stay in USD. The import derives `grossUsd` and
  `feeUsd` as paid amount ÷ rate, rounded half up to 8 fractional digits (exact when
  the rate is 1). Paid amounts and the rate are stored exactly.
- CSV import: currency comes from a currency column or from one currency for the whole
  file (`payment.currency`). The rate comes from one file-wide rate
  (`payment.perUsd`), an optional rate column, or 1 for USDT and USDC. Other non-USD
  rows without a rate are rejected, never guessed.
- Trade version responses carry `payment` only for non-USD trades; USD trades and
  USD-only CSV previews, hashes and command payloads are byte-identical to before.
- Russian UI: a "Валюта оплаты" section in CSV mapping, an optional rate column, and
  the paid amount shown next to the USD amount in the preview, batch rows and journal.

## Capabilities

### New Capabilities
- `purchase-currency`: recording and showing the currency, amounts and rate actually paid for a trade, converted to USD for accounting.

### Modified Capabilities
- `usd-csv-imports`: CSV-002 currency cells may name a non-USD currency with a rate instead of only literal USD.
- `csv-workbench`: CSVUX-001 mapping guidance describes the optional currency and rate.

## Impact

Backend: migration `AddTradePaymentRecords` (new table `account_trade_version_payments`
with CHECK constraints and a foreign key to the version), `trade-journal.store.ts`,
CSV input/parser/import service. Real PostgreSQL probes gain the new table and count.
Frontend: CSV mapping, preview, batch detail and journal tables, API types.
No new dependency, provider call or paid service.

Data impact: additive only. Existing trade versions have no payment row and keep their
exact USD values; the migration alters no existing table and rewrites no row.

Non-goals: the manual trade form/API (follows after the separate manual-form change),
automatic Bank of Russia rate lookup, storing currencies as instruments or swaps,
showing P&L in a non-USD currency, payment fields on manual corrections.
