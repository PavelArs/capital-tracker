## MODIFIED Requirements

### Requirement: AST-3 Portfolio lists the assets and adds one
The Portfolio section (`/portfolio`) SHALL list every asset of the owner from the
whole-portfolio valuation (`portfolio-valuation`), held assets first by value
(largest first, unpriced after priced) and then the others by name, in a table with
the columns Asset (name, then ticker, Type and Value currency, where Type is Crypto,
Cash or Manual for crypto, fiat and manual), Amount, Price (the price or "No price" /
"No rate", then the price source Market price, Manual or Fixed), Value, Allocation,
Avg buy price and Unrealized P&L. Values that are unknown SHALL show "—", never 0;
an asset that is not held shows amount 0. Chips All, Crypto, Cash and Manual SHALL
filter the rows by type. With no assets it SHALL say "No assets yet" and offer
"Add asset"; while loading it SHALL show a loading state and on failure a readable
error with "Try again".

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
- **THEN** the dialog closes and the list shows Deposit as Manual, RUB, amount 0, "No price" and source Manual
- **WHEN** the owner chooses the Manual chip
- **THEN** only Deposit is listed
