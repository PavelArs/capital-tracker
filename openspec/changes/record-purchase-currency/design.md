## Context

Trades are immutable versions in `account_trade_versions` with exact `grossUsd` and
`feeUsd`; FIFO, realized and unrealized results read only those. The CSV importer
(CSV-001..00x) parses a retained file with explicit settings, normalizes rows into
USD executions, hashes the preview and replays confirm commands by canonical payload.
Optional currency cells were required to be literal `USD`.

## Decisions

1. **USD stays the accounting currency.** A non-USD purchase is converted once, at
   import, and the conversion inputs are stored beside the USD values. Nothing in FIFO,
   valuation, period results or transfers changes. Alternative (per-currency books or
   currency instruments/swaps) is far larger and not what the owner asked for.
2. **Rate convention: units of paid currency per 1 USD** (`paidPerUsd`), matching how
   the Bank of Russia publishes RUB (79.0246 RUB = 1 USD) and making stablecoins 1.
   The UI labels it explicitly as "сколько единиц валюты за 1 USD".
3. **Rounding.** `usd = paid / perUsd` rounded half up to 8 fractional digits, computed
   with bigint atoms; exact when `perUsd` is 1. Eight digits keep stablecoin amounts
   exact in practice and RUB conversions far below a cent of error while staying
   readable. Paid amounts and rate are exact, so the derivation is reproducible.
4. **Separate table, no row = USD.** `account_trade_version_payments` is keyed by and
   references the version, so the existing versions table and every existing row stay
   byte-identical (the populated-upgrade probes compare them exactly) and the four
   values are all-or-nothing by construction. A USD import stores no row rather than
   `USD/…/1`, so USD history has one representation. Reads use one LEFT JOIN in the
   shared version select.
5. **Backward-compatible wire and hash.** `payment` and `columns.rate` are optional.
   The tuples used for the preview hash and confirm canonical payload append payment
   data only when present, so existing replays, hashes and fixtures stay valid and the
   parser version stays `usd-csv-v1` (every input that previewed as confirmable before
   still normalizes identically). `assertUsd` keeps its name as the amount attestation.
6. **Rate sources are explicit.** File-wide `payment.perUsd` only with a file-wide
   currency (a mixed currency column cannot share one rate); a rate column per row;
   USDT/USDC default 1. Anything else is `missing-rate`. Automatic Bank of Russia lookup
   is a possible later change; it would add a provider call and is not needed for the
   owner's two RUB purchases.
7. **Response shape.** `payment` appears only on versions that have it, so every
   existing exact-body assertion for USD trades remains true.
8. **UI.** No new table columns (existing E2E reads fixed columns); the paid amount is a
   second line in the USD gross cell. Labels change only when a non-USD currency is in
   play, so the default flow keeps its exact labels.

## Risks

- A manual correction of an imported RUB trade (existing USD-only API) creates a
  version without payment; it then reads as paid in USD. Accepted until the manual form
  gains the currency field.
- Rounded USD differs from a spreadsheet that rounds to cents by under 0.005 USD.
