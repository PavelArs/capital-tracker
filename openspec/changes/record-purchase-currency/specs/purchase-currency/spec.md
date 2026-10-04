## ADDED Requirements

### Requirement: PCUR-1 Additive paid-currency record on trade versions
The system SHALL store, for a trade version paid in a currency other than USD, the
paid currency code, exact paid gross amount, exact paid fee and exact rate expressed as
units of the paid currency per 1 USD. All four values SHALL be either present together
or absent together; absence SHALL mean the trade was paid in USD. The currency code
SHALL match `^[A-Z][A-Z0-9]{2,9}$` and SHALL NOT be `USD`; the paid gross and rate SHALL
be positive and the paid fee non-negative, each within the existing scale-30 amount
bounds. USD amounts SHALL remain the only accounting inputs: FIFO, realized and
unrealized results SHALL use `grossUsd` and `feeUsd` exactly as before.

The schema change SHALL be one additive migration creating a payment table keyed by
the trade version (owner, account, trade, version) with CHECK constraints and a
foreign key to that version. It SHALL alter no existing table, rewrite no existing row
and run only through the explicit migration command; its downgrade SHALL refuse.

Trade version projections SHALL include `payment` with `currency`, `gross`, `fee` and
`perUsd` canonical strings only when the version has a paid-currency record; a USD
version SHALL keep its previous response shape without a `payment` key.

#### Scenario: PCUR-MIGRATE Existing trades stay USD and unchanged
- **GIVEN** a database migrated to the previous schema with an imported USD trade
- **WHEN** the explicit migration command adds the payment table and runs again
- **THEN** every previous table, column, constraint and row is unchanged, the new table is empty and the rerun is a no-op
- **AND** a payment row for a missing version, a USD code, a lowercase code, zero gross, negative fee or zero rate is rejected by the database

#### Scenario: PCUR-SHAPE USD trades keep their response shape
- **WHEN** heads, history or CSV source rows are read for USD trades
- **THEN** each version has no `payment` key and all other fields are unchanged

### Requirement: PCUR-2 CSV purchase currency and rate
CSV preview and confirmation SHALL accept either a mapped currency column or one
`payment.currency` for the whole file, never both; with neither, every row is USD.
The rate SHALL come from `payment.perUsd` (only together with `payment.currency`), an
optional mapped rate column, or the fixed rate 1 for `USDT` and `USDC`; `payment.perUsd`
and a rate column SHALL NOT be combined. A non-USD row without a rate from these sources
SHALL fail with `missing-rate`. A rate cell SHALL be read with the declared decimal
separator; an empty rate cell SHALL fall back to the fixed stablecoin rate. A USD row's
rate cell SHALL be empty or equal 1.

For a non-USD row, the mapped gross and fee columns SHALL be read as paid amounts, and
the system SHALL derive `grossUsd` and `feeUsd` as paid amount divided by rate, rounded
half up to 8 fractional digits, or exactly equal to the paid amount when the rate is 1.
A derived gross of zero SHALL fail with `converted-gross-zero`; a derived buy cost above
the journal bound SHALL fail with `buy-cost-overflow` and a derived sale gross above it
with `invalid-gross`. Confirmation SHALL
store each row's exact paid currency, amounts and rate with the created version. A USD
row SHALL store no payment record.

Settings without `payment` and without a rate column SHALL produce the same preview
hash, command payload and accepted settings as before this change. Every payment and
rate setting SHALL be part of the preview hash and command payload.

#### Scenario: PCUR-RUB Owner's RUB purchase at the Bank of Russia rate
- **GIVEN** an initialized account and a CSV row buying 0.01 BTC on 2025-11-21 for gross 100000 and fee 0
- **WHEN** the owner previews it with `payment.currency` RUB and `payment.perUsd` 79.0246
- **THEN** the row has grossUsd 1265.42873991, feeUsd 0 and payment RUB 100000 / 0 / 79.0246
- **WHEN** the owner confirms the preview
- **THEN** the created version stores the same USD values and payment, FIFO remaining cost is 1265.42873991 USD
- **AND** the CSV batch rows and trade heads return that payment

#### Scenario: PCUR-MIXED Currency column with stablecoin default and rate column
- **GIVEN** rows paid in USD, USDT without a rate, and RUB with rate 77.9568
- **WHEN** the owner previews with the currency and rate columns mapped
- **THEN** the USD row has no payment, the USDT row has rate 1 and exact USD equal to its paid amounts, and the RUB row's 30000 converts to 384.82852041 USD

#### Scenario: PCUR-ERRORS Missing or invalid currency data is never guessed
- **WHEN** a row names EUR without any rate, a lowercase or too-short code, a zero or malformed rate, a USD row with rate 2, or a tiny paid gross that rounds to zero USD
- **THEN** preview returns canConfirm false with `missing-rate`, `invalid-currency`, `invalid-rate` or `converted-gross-zero` on that row and no candidate summary or hash
- **AND** settings combining a currency column with `payment`, `payment.perUsd` with a rate column, `payment.currency` USD, an invalid code or unknown payment keys fail with 400 and no write

#### Scenario: PCUR-COMPAT USD-only imports are unchanged
- **WHEN** a USD-only file is previewed and confirmed without payment settings or a rate column
- **THEN** the preview hash and command canonical payload equal the values computed by the previous formula, and confirmation creates versions without payment

### Requirement: PCUR-3 Russian payment currency in the CSV workbench and journal
The CSV mapping SHALL offer a "Валюта оплаты" choice for the whole file (USD by
default; USDT, USDC, RUB, EUR), a rate input labelled as units of the currency per 1 USD,
and an optional rate column, with Russian guidance that USDT and USDC default to 1 and
other currencies need the rate of the purchase date. With the default USD choice and no
currency column, existing labels and the USD attestation SHALL remain unchanged; with
another currency, the amount labels and attestation SHALL say the amounts are in the
payment currency. Preview rows, CSV batch rows and journal trade rows SHALL show the paid
amount, currency, fee and rate next to the USD amount for trades with a payment record.

#### Scenario: PCUR-UI Import a RUB purchase through the real workbench
- **GIVEN** a real owner session with an initialized account and the RUB purchase file
- **WHEN** the owner maps the columns, chooses RUB, enters 79.0246, attests the amounts and previews
- **THEN** the preview row shows 1265.42873991 USD with "Оплачено 100000 RUB" and the rate
- **WHEN** the owner confirms
- **THEN** the journal row shows the same USD amount and the paid RUB amount after reload
