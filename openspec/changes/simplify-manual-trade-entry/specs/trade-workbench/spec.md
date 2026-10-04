## MODIFIED Requirements

### Requirement: WORKBENCH-001 Grouped precise trade entry
Trade entry SHALL group «Что и когда» (instrument, buy/sell, calendar date with
optional UTC time) and «Сколько» (quantity, «Сумма сделки, USD», optional fee),
retaining exact string inputs and submit/disabled behavior. Amount guidance SHALL say
the total paid for a buy and the total received for a sell, not a unit price. An empty
fee SHALL be sent as 0. The same-instant order SHALL be optional, inside a collapsed
«Порядок в один момент» disclosure whose summary shows «авто» or the explicit value;
a new draft SHALL leave it empty and the command SHALL then omit it (TRADE-002), while
a correction SHALL start from the trade's saved order. A saved trade SHALL be
confirmed in plain words (side, quantity, instrument, total USD and date) without
identifiers. Amount, fee, UTC and order guidance SHALL be associated with the
corresponding control through its accessible description. A host MAY lock chosen
fields of a prefilled draft read-only. Layout SHALL fit360/768/1440px in the
existing light/dark themes without page-level horizontal overflow or truncated amounts.

#### Scenario: WORKBENCH-001-A Enter an exact operation
- **GIVEN** an authenticated owner with an initialized journal
- **WHEN** the owner enters a trade and reads its field guidance
- **THEN** quantity and USD strings are preserved exactly, the amount means the total rather than a unit price, fee is separate, time is UTC and an optional order distinguishes equal instants
- **AND** the same trade draft and editor nodes survive context/workflow changes

#### Scenario: WORKBENCH-001-B Plain same-day purchases
- **GIVEN** an initialized journal and the trade form with today's date
- **WHEN** the owner picks an instrument, enters quantity and «Сумма сделки, USD», leaves fee and order empty and saves twice on the same date
- **THEN** both commands omit the order and send fee 0, both trades are saved (orders 0 and 1) and each save is confirmed in words without identifiers
