## Why

Every later valuation step needs to know what an asset is. Hourly market prices (M3)
must ask providers only for crypto they can price, whole-portfolio valuation (M4)
must tell crypto from cash and hand-valued assets, and three-currency accounting (M5)
must know which currency an asset is valued in. Today an instrument is only a name
and an optional symbol, and the spec forbids reading anything into its label.
This is change M2 `classify-assets` of `docs/product-requirements.md` (PR-AST-1,
criteria AST-TYPES and AST-NEW; gap-analysis row 12).

## What Changes

- Each accounting instrument (asset) gains `assetType` (crypto, fiat, manual),
  `valuationCurrency` (USD, EUR, RUB) and `priceSource` (market, manual, fixed).
  Name and symbol stay as they are; the symbol is the asset's ticker.
- The server derives the price source from type and ticker: crypto with a ticker the
  app can price (BTC, ETH, SOL, USDT, USDC, ZEC, TRX, XLM) is `market`, any other
  crypto is `manual`, fiat (USD, EUR, RUB cash) is `fixed` in its own currency, and a
  manual asset is `manual` in the currency the owner picks.
- `POST /accounting/instruments` accepts optional `assetType` and `valuationCurrency`.
  The legacy body `{requestId, name, symbol}` keeps working and keeps its idempotency
  payload; it is classified by the same rule the migration uses.
- `GET /accounting/instruments` and the create response return the three new fields.
- Additive migration `ClassifyAssets1790700000000` adds the columns, classifies
  existing rows (known crypto ticker → crypto/market/USD, everything else →
  manual/manual/USD) and adds PostgreSQL checks for the allowed combinations.
- The Portfolio section of the new shell lists the assets with ticker, type, value
  currency and price source, filters them by type and adds an asset through an "Add
  asset" dialog. It replaces the Portfolio placeholder from M1.

## Capabilities

### New Capabilities
- `asset-classification`: asset type, valuation currency and price source for every
  instrument, their derivation rules, the additive migration and the Portfolio list.

### Modified Capabilities
- `manual-opening-positions`: OPEN-001 no longer says labels may not imply fiat
  identity; an explicit asset type now does, while labels alone still imply nothing.
- `application-shell`: SHELL-005 drops Portfolio from the placeholder sections.

## Impact

Depends on M1 (`add-app-shell`, PR #38) for the Portfolio route. Backend:
`backend/src/accounting` input parsing, `accounting.service.ts`, entity and one
migration. Frontend: a new `portfolio-assets.api.ts` client and a new `features/portfolio` page.
Tests: backend unit tests, a new real-PostgreSQL probe, the migration probe and the
probes that count migrations.

Data impact: three new columns on `accounting_instruments` with defaults
manual/USD/manual, filled for existing rows by the rule above. No row is deleted, no
existing column or value changes, and no trade, lot, price or P&L value changes.
Owner data in production is classified when Pavel runs the migration during his
next deploy.

Non-goals: quantities, prices, values or P&L in the Portfolio list (M4); collecting
market prices (M3); valuing a manual asset in EUR or RUB (M5, until then manual
prices stay USD-only); network, contract and decimals for tokens (M14, M15); editing
or reclassifying an existing asset; choosing `fixed` for stablecoins; retiring the
legacy `assets` module (M20).
