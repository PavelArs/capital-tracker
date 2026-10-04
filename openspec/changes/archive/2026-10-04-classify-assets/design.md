## Context

`accounting_instruments` (migration 13) holds owner-scoped instruments with `name`,
an optional `symbol` and a constant `namespace = 'manual'`. Every journal (openings,
trades, carry-in, transfers, rewards, swaps, manual prices) references instruments by
`(ownerId, id)` with `ON DELETE RESTRICT`. Only `AccountingService.createInstrument`
inserts rows; several E2E fixtures insert directly with the old column list. The
product model (`docs/product-requirements.md`, section 4 "Asset") adds asset type,
valuation currency and price source; network, contract, decimals and a provider
reference come with the chain and price changes that need them.

## Goals / Non-Goals

Goals: store and return a classification that M3 (prices), M4 (valuation) and M5
(three currencies) can rely on; classify Pavel's existing instruments without
touching any accounting row; show the classification in the new Portfolio section.
Non-goals: see proposal.

## Decisions

1. **Columns on the existing table, not a new table.** The classification is one
   value per asset and immutable in this change, so three `text` columns with CHECK
   lists keep reads a single row and avoid a join in every journal projection. A new
   type or currency is a one-line CHECK change, which is not a rewrite of rows
   (PR-AST-1).
2. **Server-derived price source.** The client chooses the type (and currency for
   manual assets); the server decides `market`, `manual` or `fixed`. That keeps one
   rule for the API, the legacy body and the migration, and stops a client from
   claiming a market source the app cannot serve. The known market tickers are BTC,
   ETH, SOL (MVP wallets), USDT, USDC (MVP tokens, Q7) and ZEC, TRX, XLM (Pavel's
   manual holdings, D4, all listed on Kraken). M3 may extend the list.
3. **Crypto is valued in USD; fiat in itself.** Providers quote crypto in USD and
   EUR/RUB come from Bank of Russia rates in M5, so `valuationCurrency` is the quote
   currency of the asset's own price, not the owner's accounting currency. Nothing in
   this change assumes USD is the only accounting currency.
4. **Fiat is limited to USD, EUR and RUB** because only those have FX series (Q1).
   Fiat is `fixed`: one unit is worth one unit of its own currency.
5. **Defaults keep old writers working.** Column defaults are manual, USD, manual, the
   classification that claims nothing. Direct SQL fixtures and any unknown writer
   therefore produce valid rows; the service always writes explicit values.
6. **Backfill by ticker.** The migration sets crypto/USD/market where
   `upper(symbol)` is a known market ticker, as section 4 prescribes. "Cash USD" with
   ticker USD stays manual (AST-TYPES), because an old label was never declared fiat.
   The migration holds its own frozen ticker list so a later code change cannot alter
   what it did.
7. **Replay identity.** The legacy body keeps the canonical payload
   `{name, symbol}`, so pre-migration requests replay to 200. A body with any
   classification field stores `{name, symbol, assetType, valuationCurrency}` with the
   resolved currency. Two bodies that differ only in an omitted versus explicit
   default currency therefore replay as the same request.
8. **Portfolio is a classification list for now.** M4 turns it into valued holdings.
   The list loads every page of `GET /accounting/instruments` (cursor paging, 100 per
   page) and sorts on the client; there is no new list endpoint.

## Risks / Trade-offs

- A misclassified old instrument cannot be corrected in the UI yet. Pavel's
  instruments are BTC, ETH, SOL, ZEC, TRX and XLM (from his CSVs), which all become
  crypto/market. Reclassification can follow as its own change if needed.
- Manual assets valued in EUR or RUB cannot get a value yet: manual prices are USD
  only until M5. The Portfolio list shows no prices, so nothing is shown wrongly.
- Strict-schema probes that compare every column of `accounting_instruments` before
  and after an upgrade must allow exactly the three new columns and two checks.

## Migration Plan

`1790700000000-ClassifyAssets` (next free timestamp; 1790500000000 and 1790600000000
remain reserved by the closed currency and address-link branches). In one
transaction: add the three columns with defaults (PostgreSQL 11+ adds a column with a
constant default without rewriting the table), update the classification of rows
with a known crypto ticker, then add the value and combination checks. The probes
that count migrations move from 23 to 24. `down` refuses, like every accounting
migration. Rollback is a code revert; the extra columns are ignored by older code.
