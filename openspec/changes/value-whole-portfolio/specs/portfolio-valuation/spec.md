## ADDED Requirements

### Requirement: PV-1 Whole-portfolio valuation without selecting accounts
`GET /accounting/portfolio` SHALL value every manual account the owner holds at the
current instant, without an account selection. Holdings SHALL come from each
account's current effective connected history (openings, carry-in, trades, transfers,
rewards and swaps) at that instant and be summed per asset instrument across accounts,
so a lot moved between two own accounts counts once. An account without a journal
holds nothing; an account whose coverage starts after the instant SHALL be reported as
unavailable and make the total incomplete. Every asset instrument of the owner SHALL
be listed, held or not, with its classification and its holding in each account.

The read SHALL use one read-only repeatable-read PostgreSQL snapshot, require the full
owner session, accept no query parameters (400), return only the caller's data, call
no provider and change no row. Persisted history that cannot be replayed SHALL fail
(409), never appear as an empty portfolio.

#### Scenario: PV-TOTAL The total covers every account
- **GIVEN** accounts "Trust Wallet" and "Bybit" holding BTC and USDT, and another owner's account
- **WHEN** the owner reads the portfolio
- **THEN** the total and each asset's quantity cover both of the owner's accounts, each asset lists its holding per account, and the other owner's holdings are absent
- **AND** a lot transferred from "Bybit" to "Trust Wallet" is counted once, in "Trust Wallet".

#### Scenario: PV-PRIVATE Strict, private and read-only
- **WHEN** an anonymous or MFA-pending client or a request with a query parameter reads the portfolio
- **THEN** it is refused with 401/403/400 without data
- **AND** successful reads change no stored row and make no provider request.

### Requirement: PV-2 Prices follow the asset's price source
Each held asset SHALL be priced in USD by its price source (`asset-classification`):
`market` uses the latest `price_observations` row for its ticker at or before the
instant from any provider, with status `fresh` when at most 2 hours old and `stale`
otherwise (a stale price is still used); `manual` uses the latest manual USD price
point at or before the instant whose current version is not void; `fixed` USD is 1;
fixed EUR and RUB have no USD rate until three-currency accounting and are reported
as `no-rate`. An asset without a price SHALL show `no-price` (or `no-rate`), have a
null value, and make the portfolio total null while the priced subtotal and the
missing count are reported. Nothing missing SHALL be shown as 0.

#### Scenario: PV-MARKET Spreadsheet row at a market price
- **GIVEN** a buy of 0.00918359 BTC for 1000 USD and a stored BTC observation of 84945 USD from 30 minutes ago
- **WHEN** the portfolio is read
- **THEN** BTC is priced 84945 with its source and status `fresh`, its value is 780.10005255 (shown 780.10) and its unrealized P&L is −219.89994745 (−21.99 %).

#### Scenario: PV-STALE A three-hour-old price is used and marked
- **GIVEN** the only BTC observation is 3 hours old
- **WHEN** the portfolio is read
- **THEN** the value uses that price and BTC's price status is `stale` with its observed instant.

#### Scenario: PV-NONE No price is not zero
- **GIVEN** a held asset with no observation or manual price and a priced asset
- **WHEN** the portfolio is read
- **THEN** the unpriced asset shows `no-price` with null value and allocation, the total is null and incomplete, and the priced subtotal equals the priced asset's value.

#### Scenario: PV-MANUAL Latest effective manual price
- **GIVEN** a manual asset with manual prices at two earlier instants, the later one voided, and one in the future
- **WHEN** the portfolio is read
- **THEN** the earlier price is used and the future price is ignored.

#### Scenario: PV-FIXED Cash in its own currency
- **GIVEN** USD cash of 1500 and RUB cash of 100000
- **WHEN** the portfolio is read
- **THEN** USD cash is worth 1500 at a fixed price of 1 and RUB cash is `no-rate` with null value.

### Requirement: PV-3 Cost basis, average buy price and P&L per asset
For each asset the system SHALL report the FIFO cost basis of the remaining lots, the
average buy price (that cost divided by the remaining known-cost quantity), unrealized
P&L (value minus cost basis, with its return percent) and realized P&L (FIFO sales and
swaps of that asset, net of fees, Q2), and the same totals for the portfolio. When part
of the remaining quantity has unknown cost, the cost basis and unrealized P&L SHALL be
null with the known-cost subtotal and the unknown quantity reported, and the average
buy price SHALL use only the known-cost quantity. Realized P&L with an unknown-cost
disposal SHALL be null with the known subtotal reported.

#### Scenario: PV-BR11 Two buys and a price
- **GIVEN** BTC buys totalling 1.2 BTC for 66000 USD and a BTC price of 80000
- **WHEN** the owner reads the portfolio
- **THEN** BTC shows amount 1.2, average buy price 55000, cost basis 66000, value 96000 and unrealized P&L +30000 (45.45 %).

#### Scenario: PV-REALIZED FIFO realization
- **GIVEN** buys of 1 BTC at 50000 and 1 BTC at 60000 and a sale of 1.5 BTC for 105000 without fee
- **WHEN** the portfolio is read
- **THEN** BTC realized P&L is 25000, 0.5 BTC remains with cost basis 30000 and average buy price 60000, and the portfolio realized P&L includes 25000.

#### Scenario: PV-UNKNOWN-COST Partly unknown cost
- **GIVEN** 1 BTC bought for 50000 and 0.5 BTC opened with unknown cost
- **WHEN** the portfolio is read
- **THEN** BTC quantity is 1.5, cost basis and unrealized P&L are null, the known-cost subtotal is 50000 with 0.5 unknown, and the average buy price is 50000.

### Requirement: PV-4 Allocation by asset, type and account
The system SHALL report allocation shares of the priced value by asset, by asset type
(Crypto, Cash, Manual) and by account, each with its USD value and a percentage with
two decimals, largest first. Assets without a price SHALL be excluded from allocation
and the allocation marked incomplete.

#### Scenario: PV-ALLOC Shares of the portfolio
- **GIVEN** BTC worth 4200, ETH 2000, USD cash 1500 and a manual deposit 2300 held in two accounts
- **WHEN** the portfolio is read
- **THEN** allocation by asset is BTC 42 %, Deposit 23 %, ETH 20 %, USD cash 15 %; by type Crypto 62 %, Manual 23 %, Cash 15 %; and by account each account's share of 10000.

### Requirement: PV-5 Portfolio and Asset details screens
The Portfolio section (`/portfolio`) SHALL show a summary with current value, cost
basis, unrealized and realized P&L in USD; an allocation card that groups by Asset,
Type or Account; and the assets table defined by AST-3. An incomplete total SHALL read
"Incomplete" with the priced subtotal, how many assets have no price and whether an
account history starts later; a refresh that fails keeps the values already shown, and
a late reply never replaces a newer one. Selecting an
asset SHALL open `/portfolio/:assetId` with a link back to Portfolio, the asset's name,
ticker and type, its price with source and age ("Kraken · updated 30 min ago", "stale" when older
than 2 hours, "Manual price set for <date>", "Fixed", "No price" or "No rate"), amount, current value, average buy price, cost
basis, unrealized and realized P&L, a note when part of the amount has no purchase
price, and the holding in each account. Numbers SHALL be rounded only for display:
USD with two decimals (prices below 1 with up to six), quantities with up to eight.

#### Scenario: PV-UI Value and P&L of one asset
- **GIVEN** a signed-in owner whose account bought 1.2 units of a manually priced asset for 66000 USD and a manual price of 80000
- **WHEN** the owner opens Portfolio
- **THEN** the asset row shows amount 1.2, price $80,000.00, value $96,000.00, average buy price $55,000.00 and unrealized P&L +$30,000.00 with +45.45%, and the allocation card can group by Asset, Type and Account
- **WHEN** the owner opens the asset
- **THEN** its page shows the same numbers, cost basis $66,000.00, realized P&L $0.00, price "Manual" and the holding in that account.
