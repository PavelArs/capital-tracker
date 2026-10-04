# unrealized-profit-loss Specification

## Purpose
Show exact unrealized profit or loss (value minus remaining FIFO cost) and a rounded return for valued positions, accounts and selected-account aggregates, never guessing missing prices or costs.
## Requirements
### Requirement: UPNL-1 Exact unrealized result per valued position
The system SHALL return, for each position returned by account valuation or
selected-accounts valuation, `unrealizedPnlUsd` equal to the position's exact `valueUsd` minus
its remaining FIFO `costUsd`, as a canonical signed decimal string without
intermediate rounding. It SHALL return `unrealizedReturnPercent` equal to
`unrealizedPnlUsd / costUsd * 100`, rounded half away from zero to exactly two
fractional digits, with no negative zero.

When the exact-time price is missing, or the position cost is unknown (any held
quantity has unknown basis), both fields SHALL be `null`; the system SHALL NOT use a
known-cost subtotal, zero, income or another instrument as a substitute. When cost is
known zero, `unrealizedPnlUsd` SHALL equal the value and `unrealizedReturnPercent`
SHALL be `null`. An explicit price of zero is a known price.

#### Scenario: UPNL-EXCEL Owner spreadsheet row
- **GIVEN** a covered account bought 0.00918359 of an instrument for gross 1000 USD with fee 0
- **AND** a manual price of 84945 USD exists at the valuation instant
- **WHEN** the owner values the account at that instant
- **THEN** the position has valueUsd 780.10005255, costUsd 1000, unrealizedPnlUsd -219.89994745 and unrealizedReturnPercent -21.99
- **AND** the account totals report unrealizedPnlUsd -219.89994745 and unrealizedReturnPercent -21.99

#### Scenario: UPNL-GAPS Missing price, unknown cost and zero cost
- **GIVEN** one position without an exact-time price, one position with partly unknown carried basis, and one position with known zero cost priced 5
- **WHEN** the account is valued
- **THEN** the unpriced and unknown-cost positions have null unrealizedPnlUsd and null unrealizedReturnPercent
- **AND** the zero-cost position has unrealizedPnlUsd equal to its value and null unrealizedReturnPercent

### Requirement: UPNL-2 Honest unrealized totals
The system SHALL return, for account valuation, each covered account in
selected-accounts valuation and the selected-account aggregate, `unknownCostCount` (positions with unknown
cost), `unrealizedPnlUsd` and `unrealizedReturnPercent`. The total `unrealizedPnlUsd`
SHALL be the exact sum over positions only when every position has a non-null
`unrealizedPnlUsd` and, for the aggregate, every selected account is covered;
otherwise it SHALL be `null`. The total return SHALL be the total result divided by
the summed cost, rounded as in UPNL-1, and `null` when the total is null or the summed
cost is zero. An account with no positions SHALL report a total of 0 and a null
return. Unavailable accounts SHALL report null totals and null `unknownCostCount`.

Authentication, MFA, CSRF, owner scoping, no-store, read-only snapshot and request
validation SHALL remain exactly as in VAL and MPV; the new fields SHALL add no write,
provider request or new input.

#### Scenario: UPNL-PORTFOLIO Selected aggregate across accounts
- **GIVEN** two selected covered accounts hold 0.5 (cost 50) and 2 (cost 200) of the same instrument priced 123.456
- **WHEN** the owner previews both accounts
- **THEN** the accounts report unrealizedPnlUsd 11.728 and 46.912 with return 23.46
- **AND** the aggregate reports unrealizedPnlUsd 58.64 and unrealizedReturnPercent 23.46
- **WHEN** an unpriced account or an account without history is added to the selection
- **THEN** the aggregate unrealizedPnlUsd and return are null while covered priced accounts keep their own results

### Requirement: UPNL-3 Russian display of unrealized result
The account valuation form and the selected-accounts valuation panel SHALL show the
unrealized result and return next to cost and value, using the exact strings from the
backend with a percent sign for the return. A null position result SHALL name its
reason in Russian ("Нужна точная цена" or "Неизвестна себестоимость"); a null account
total SHALL list the missing-price and unknown-cost counts; a null selected-account
total SHALL read "Не определена" beside the existing coverage and missing-price counts.
A null return beside a known result (zero cost) SHALL show a dash. No null SHALL be
shown as zero. The account method note SHALL no longer claim that profit is excluded.

#### Scenario: UPNL-UI Account valuation shows the spreadsheet difference
- **GIVEN** a valued account containing the UPNL-EXCEL position
- **WHEN** the owner calculates the account valuation at the price instant
- **THEN** the summary shows "Нереализованная прибыль, USD" -219.89994745 and "Доход, %" -21.99 %
- **AND** the positions table shows the same values in the position row
- **WHEN** one position has no exact price and another has unknown cost
- **THEN** their result cells say "Нужна точная цена" and "Неизвестна себестоимость", the price cell still says "Нет точной цены", and the summary lists both counts instead of a total

#### Scenario: UPNL-UI-BROWSER Real login, refresh and selected accounts
- **GIVEN** an owner logged in with password and MFA over HTTPS against PostgreSQL
- **WHEN** they value an account with one unpriced position, then add a zero price and refresh
- **THEN** the unpriced row says "Нужна точная цена" and the summary explains the gap, and after refresh the summary shows -300 and -66.67 %
- **WHEN** they preview two selected accounts holding 0.5 and 2 units bought at 100 per unit and priced 123.456
- **THEN** the panel shows 58.64 and 23.46 % in total and per-account results 11.728 and 46.912

