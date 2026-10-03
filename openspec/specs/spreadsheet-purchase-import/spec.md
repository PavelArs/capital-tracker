# spreadsheet-purchase-import Specification

## Purpose
Import the owner's Excel purchase sheet as is through the existing CSV importer, with explicit
interpretation of omitted columns, duplicate protection and a read-only reconciliation of the
sheet's derived numbers against exact app values.

## Requirements
### Requirement: SHEET-1 Explicit purchase-sheet interpretation
The CSV importer SHALL accept the owner's purchase-sheet layout through the existing
upload, inspect, preview, confirm and rollback routes, using only explicit settings:

- `format.delimiter` SHALL additionally accept a tab character for inspection and preview.
- `format.timestampMode: "day-month-year-utc"` SHALL accept exactly `DD.MM.YYYY`
  (two-digit day, two-digit month, four-digit year, dots, no spaces or time) with the
  strict calendar of the journal (years 1970..9999, leap days) and SHALL normalize it to
  `YYYY-MM-DDT00:00:00.000Z`, the start of that calendar date in UTC. It SHALL NOT accept
  `fixedOffset`, and SHALL NOT read a time, offset, browser or server timezone.
- `mapping.columns.side` MAY be omitted only together with `mapping.allRowsSide: "buy"`
  and an empty `mapping.sides`; every row is then a purchase. `allRowsSide` SHALL be
  rejected when a side column is mapped. No other value is accepted.
- `mapping.columns.feeUsd` MAY be omitted only together with top-level
  `feeIncludedInGross: true`; every row then has fee `0` and its cost basis equals the
  mapped gross USD total. `feeIncludedInGross` SHALL be rejected when a fee column is mapped.
- `mapping.columns.order` MAY be omitted only in `day-month-year-utc` mode. Rows of one
  date SHALL then take consecutive orders, in file order, starting one above the largest
  `orderWithinTimestamp` the account occupies at that instant (active trades, rewards,
  swaps and transfers on either side), or at 1 when none.
- Settings that omit a column without its explicit companion, or carry a companion with
  the column mapped, SHALL fail with 400 and write nothing.

The payment-currency and paid-amount columns of the sheet SHALL remain ignored source
columns; the USD amount column is mapped as the gross USD total and the existing USD
attestation still applies. The sheet's derived columns SHALL be ignored on import.
Settings that use none of these options SHALL keep their exact previous behavior,
canonical command payload and preview hash.

#### Scenario: SHEET-SAMPLE Owner's sample row imports as one purchase
- **GIVEN** an initialized USD journal with coverage from 2025-01-01T00:00:00.000Z and an owned BTC instrument
- **AND** a UTF-8 tab-separated file with the header `Дата	Купил	Количество	Купил за	За количество	в USD	Курс	Текущий курс	Текущая стоимость	Разница	Доход` and the row `13.06.2025	BTC	0,00918359	USDT	1000	1000	108889,8786	84945	780,1000526	-219,8999475	-21,99%`
- **WHEN** the owner previews it with tab delimiter, decimal comma, `day-month-year-utc`, columns Дата/Купил/Количество/в USD, no side, fee or order column, `allRowsSide: "buy"`, `feeIncludedInGross: true` and the USD attestation
- **THEN** the preview is confirmable with one buy of 0.00918359 BTC at 2025-06-13T00:00:00.000Z, order 1, gross 1000 USD and fee 0
- **AND** the ignored columns are exactly Купил за, За количество, Курс, Текущий курс, Текущая стоимость, Разница and Доход
- **AND** after confirmation the journal summary shows gross buys 1000, buy fees 0 and remaining cost 1000

#### Scenario: SHEET-SAME-DAY Same-day, same-amount purchases stay distinct
- **GIVEN** a sheet with two identical rows dated 01.07.2025 and a third row on another date
- **AND** the account already has an active trade at 2025-07-01T00:00:00.000Z with order 4
- **WHEN** the owner previews and confirms it in date mode without an order column
- **THEN** three trades are created; the two same-day rows get orders 5 and 6 in file order and the other row gets order 1

#### Scenario: SHEET-INVALID Bad sheet cells never import a subset
- **WHEN** a date-mode sheet contains `31.02.2025`, `2025-06-13`, `13.06.2025 10:00`, `1.6.2025`, an empty date, a quantity `1 000`, a quantity `0.5` under decimal comma, or a zero USD amount
- **THEN** every row remains represented, the affected rows carry `invalid-time`, `invalid-quantity` or `invalid-gross`, the preview has no candidate summary or hash, and confirmation is refused without writing a trade

#### Scenario: SHEET-EXPLICIT Omitted columns need their explicit companion
- **WHEN** settings omit the side column without `allRowsSide`, omit the fee column without `feeIncludedInGross`, omit the order column outside date mode, send `allRowsSide` with a mapped side column, send `allRowsSide: "sell"`, or send `fixedOffset` in date mode
- **THEN** preview returns 400 and no batch, trade or command row changes

### Requirement: SHEET-2 Duplicate guard for date-only purchases
In `day-month-year-utc` mode, preview and confirmation SHALL report the row error
`matches-existing-trade` for each row whose normalized instrument, side, instant,
quantity, gross and fee equal those of an active (not voided) trade already in the
account. Rows within the same file SHALL NOT be compared with each other. Exact-byte
re-upload SHALL keep returning the original batch (CSV-001). A rolled-back batch's
trades are voided and SHALL NOT block a corrected re-import.

#### Scenario: SHEET-DUPLICATE A re-saved sheet cannot import twice
- **GIVEN** the sample sheet is confirmed
- **WHEN** the owner uploads a re-saved copy with different bytes containing the sample row and one new purchase, and previews it with the same settings
- **THEN** the sample row has `matches-existing-trade`, the new row is valid, the preview is not confirmable and nothing is written
- **WHEN** the original batch is rolled back and the copy is previewed again
- **THEN** both rows are valid and the copy can be confirmed

### Requirement: SHEET-3 Batch reconciliation against the sheet
The system SHALL provide `GET /accounting/accounts/:id/csv-imports/:batchId/reconciliation`
for a committed batch with the existing full-session and owner scope, as a read-only
REPEATABLE READ snapshot. Query parameters `usdAmount`, `rate`, `currentRate`,
`currentValue`, `difference` and `returnPercent` SHALL each be an optional, distinct
zero-based column index of the stored source (at least one required); unknown,
duplicate, malformed or out-of-range parameters SHALL return 400. A draft or rolled-back
batch SHALL return 409; an inaccessible account or batch generic 404.

For every imported row the response SHALL include the ordinal, start line, trade id,
status (`imported`, `modified` when the trade's current head is a later correction, or
`voided`), the current side, and for non-voided rows the current instrument, instant and
quantity. For purchases it SHALL return `costUsd` = gross + fee and, for each requested
column, the sheet cell, the app value and a result; a sale (for example a row later
corrected into a sale) SHALL have null cost, no checks and no price fields and SHALL be
left out of the totals:

- `usdAmount` compares cost; `rate` compares cost / quantity;
- with a readable `currentRate` R: `currentValue` compares quantity × R, `difference`
  compares quantity × R − cost, `returnPercent` compares (quantity × R − cost) / cost × 100;
- sheet cells are read with the batch's accepted decimal separator, an optional leading
  `-` and, for `returnPercent` only, an optional trailing `%`; no grouping or spaces;
- a cell matches when the exact app value rounds to it, that is, differs from it by at
  most half a unit in the last decimal place the cell shows (0.5 for an integer cell),
  ties included; otherwise `mismatch`;
  an unreadable cell is `unreadable`; a check needing an unreadable or unrequested
  current rate is `unavailable`;
- the displayed app value SHALL be rounded half away from zero to the cell's decimal
  places, or to two places when the cell is unreadable.

Each purchase row SHALL also report the latest manual USD price of its instrument
(the most recent observation whose latest revision is not void, with its instant) and,
at that price, exact `valueUsd`, exact `unrealizedPnlUsd` and `unrealizedReturnPercent`
rounded to two places, or nulls when no such price exists. Totals SHALL count matches,
mismatches, unreadable and unavailable checks, sum `costUsd` of purchases, and sum
`unrealizedPnlUsd` only when every purchase row has a price. These per-purchase results
value each purchase's full quantity and do not account for later sales; the UI SHALL say so. The route SHALL write nothing and SHALL NOT
call a provider.

#### Scenario: SHEET-RECON-SAMPLE The owner's numbers match the app
- **GIVEN** the confirmed sample sheet and a manual BTC price of 84945 USD
- **WHEN** the owner requests reconciliation with columns в USD, Курс, Текущий курс, Текущая стоимость, Разница and Доход
- **THEN** the row reports quantity 0.00918359 and cost 1000, and every check matches: 1000 / 1000, 108889,8786 / 108889.8786, 780,1000526 / 780.1000526, -219,8999475 / -219.8999475 and -21,99% / -21.99
- **AND** the latest price is 84945 with value 780.10005255, unrealized P&L -219.89994745 and return -21.99, and the totals report 5 matches and 0 mismatches

#### Scenario: SHEET-RECON-MISMATCH Stale or unreadable sheet cells are visible
- **GIVEN** a confirmed sheet whose second row has a `Текущая стоимость` that disagrees by more than one unit in its last place, and a `Доход` cell `#DIV/0!`
- **WHEN** the owner requests reconciliation
- **THEN** that row reports `mismatch` for current value and `unreadable` for return, the other checks still match, and the totals count them
- **AND** with no manual price for the instrument the row's price, value and unrealized fields are null and the unrealized total is null

#### Scenario: SHEET-RECON-STATE Reconciliation follows batch and trade state
- **WHEN** reconciliation is requested for a draft or rolled-back batch, another owner's batch, or with an unknown, duplicate or out-of-range column parameter
- **THEN** the response is 409, generic 404 or 400 respectively and nothing is written
- **WHEN** one imported trade is later corrected and another is voided manually
- **THEN** the corrected row is `modified` and compared with its current values, and the voided row is `voided` without app values

### Requirement: SHEET-4 Russian purchase-sheet workflow
The CSV workbench SHALL offer a tab delimiter option, the date mode labelled as a date
without time interpreted as midnight UTC, and «Не сопоставлена» for the side, fee and
order columns. Leaving side or fee unmapped SHALL require the visible checkboxes
«Все строки — покупки» and «Комиссия уже включена в сумму в USD»; leaving order
unmapped SHALL be allowed only in the date mode. A «Заполнить по таблице покупок»
action SHALL select columns by the exact headers Дата, Купил, Количество and в USD,
set decimal comma and the date mode, and tick the two checkboxes; it SHALL NOT map
instruments or tick the USD attestation. For a committed batch with an inspected
source, the workbench SHALL let the owner choose the reference columns (prefilled by
the headers в USD, Курс, Текущий курс, Текущая стоимость, Разница and Доход) and show
the reconciliation table with sheet and app values, the result per cell, the latest
manual price and app unrealized P&L, and the totals.

#### Scenario: SHEET-UI Owner imports and reconciles the sheet in Russian
- **GIVEN** a real owner session, an initialized journal and an owned BTC instrument
- **WHEN** the owner uploads the tab-separated sample sheet, inspects it with «Табуляция», applies «Заполнить по таблице покупок», maps BTC, confirms the USD attestation, previews and confirms
- **THEN** the journal shows one purchase on 13.06.2025 with cost 1000 USD
- **WHEN** the owner opens «Сверка с таблицей» for the committed batch
- **THEN** every compared cell for the row is shown as «совпадает» next to the sheet's value

