# asset-classification Specification

## Purpose
Classify every asset by type (crypto, cash, manual), valuation currency (USD, EUR, RUB) and derived price source (market, manual, fixed), upgrade existing instruments additively, and list and add assets in Portfolio.
## Requirements
### Requirement: AST-1 Every asset has a type, valuation currency and price source
The system SHALL store for every accounting instrument (asset) an `assetType` of
`crypto`, `fiat` or `manual`, a `valuationCurrency` of `USD`, `EUR` or `RUB` and a
`priceSource` of `market`, `manual` or `fixed`, and SHALL return all three next to
`name` and `symbol` (the ticker) in instrument create and list responses.

`POST /accounting/instruments` SHALL accept the optional fields `assetType` and
`valuationCurrency` beside `requestId`, `name` and `symbol`; the client SHALL NOT send
`priceSource`. The server SHALL derive the classification:

- `crypto` requires a ticker and is valued in USD. Its source is `market` when the
  ticker, compared case-insensitively, is one the app can price (BTC, ETH, SOL, USDT,
  USDC, ZEC, TRX, XLM); otherwise it is `manual`.
- `fiat` requires a ticker of USD, EUR or RUB (case-insensitive), is valued in that
  currency and has source `fixed`.
- `manual` has source `manual`, an optional ticker, and is valued in the given
  currency, USD when none is given.
- A `valuationCurrency` that contradicts these rules, a `valuationCurrency` without
  `assetType`, an unknown type or currency, or a non-string value SHALL be refused
  with 400 and no write.

A request with any classification field is identified for replay by its name, ticker,
type and resolved valuation currency; the same request id with the same body SHALL
return the stored asset with 200, and with a different body 409. PostgreSQL SHALL
enforce the allowed values and combinations for every write, including direct SQL.
Adding a type, currency or source later SHALL need only these checks and rules, not a
rewrite of existing rows. Authentication, MFA, CSRF, owner scoping and pagination of
the instrument routes SHALL stay as in OPEN-001.

#### Scenario: AST-NEW Add a manual deposit valued in rubles
- **GIVEN** a signed-in owner
- **WHEN** the owner adds "Deposit" of type manual with valuation currency RUB and no ticker
- **THEN** the response is 201 with assetType manual, valuationCurrency RUB, priceSource manual and symbol null
- **AND** the asset appears in the instrument list with the same fields
- **WHEN** the same request is sent again
- **THEN** the response is 200 with the same asset and no second row exists

#### Scenario: AST-RULES Derived sources and refused combinations
- **WHEN** the owner adds crypto "Bitcoin" with ticker btc, crypto "Toncoin" with ticker TON and fiat "Rubles" with ticker RUB
- **THEN** Bitcoin is crypto, USD, market; Toncoin is crypto, USD, manual; Rubles is fiat, RUB, fixed
- **WHEN** a request is fiat with ticker GBP, crypto without a ticker, crypto valued in EUR, fiat USD valued in RUB, a valuation currency without a type, type "stock", a numeric type or a `priceSource` field
- **THEN** each is refused with 400 and the instrument table is unchanged
- **AND** a direct SQL insert of fiat with source market, or of crypto valued in RUB, is rejected by PostgreSQL

### Requirement: AST-2 Existing assets are classified without changing accounting
The migration `ClassifyAssets1790700000000` SHALL add the three columns to
`accounting_instruments` with defaults `manual`, `USD` and `manual`, so writers that
do not name them keep working, and SHALL classify existing rows: a row whose ticker is
a known market crypto ticker (case-insensitive) becomes crypto, USD, market; every
other row stays manual, USD, manual. It SHALL NOT delete rows or change any other
column or table, and SHALL refuse to run down. The legacy create body
`{requestId, name, symbol}` SHALL keep its original replay identity and be classified
by the same rule as the migration.

#### Scenario: AST-TYPES Existing instruments are classified on upgrade
- **GIVEN** a database at the previous migration with instruments BTC, ETH (ticker in lower case) and "Cash USD" (ticker USD), an account with an opening, trades and manual prices that use them
- **WHEN** the migration runs
- **THEN** BTC and ETH are crypto valued in USD with price source market
- **AND** "Cash USD" is manual valued in USD with price source manual
- **AND** every row of every other table and every previous column value is unchanged, and the account valuation is identical before and after
- **AND** running the migration again applies nothing and its down step refuses

#### Scenario: AST-LEGACY The previous create body still works
- **GIVEN** an instrument created before the migration through `{requestId, name, symbol}`
- **WHEN** the same request is replayed after the migration
- **THEN** the response is 200 with the original asset and its classification
- **WHEN** a new legacy-shaped request names ticker ETH, or names no ticker
- **THEN** the first is crypto, USD, market and the second manual, USD, manual

### Requirement: AST-3 Portfolio lists the assets and adds one
The Portfolio section (`/portfolio`) SHALL list every asset of the owner, loading all
pages of the instrument list, sorted by name, in a table with the columns Asset (name
and ticker), Type (Crypto, Cash or Manual for crypto, fiat and manual), Value currency
and Price source (Market price, Manual or Fixed). Chips All, Crypto, Cash and Manual
SHALL filter the rows by type. With no assets it SHALL say "No assets yet" and offer
"Add asset"; while loading it SHALL show a loading state and on failure a readable
error with "Try again". It SHALL NOT show quantities, prices, values or totals; a line
SHALL say these arrive with portfolio valuation.

"Add asset" SHALL open a dialog with Type (Crypto, Cash, Manual), Name, Ticker
(required for Crypto, optional for Manual) and, for Cash and Manual, Currency (USD,
EUR, RUB); for Cash the currency is the ticker. Saving SHALL send one create request
with a fresh request id, keep it for retries of the same form, close the dialog and
show the new row; a refusal SHALL keep the dialog open with the error.

#### Scenario: AST-UI Add a deposit and see the classification
- **GIVEN** a signed-in owner with assets BTC and Toncoin
- **WHEN** the owner opens Portfolio
- **THEN** BTC shows Crypto, USD, Market price and Toncoin shows Crypto, USD, Manual
- **WHEN** the owner adds "Deposit" of type Manual in RUB
- **THEN** the dialog closes and the list shows Deposit as Manual, RUB, Manual
- **WHEN** the owner chooses the Manual chip
- **THEN** only Deposit is listed

