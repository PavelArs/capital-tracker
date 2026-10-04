## ADDED Requirements

### Requirement: DATE-1 Calendar date with optional UTC time
Every owner-facing control that selects an instant for a command or a read SHALL be
a native calendar date input labelled by the field's purpose (for example «Дата
сделки») followed by a native time input whose label names the same purpose and UTC
(for example «Время сделки, UTC») and is unique on its page, or within its group
where a form repeats one group per item (carry-in lots). The date SHALL be required where the instant is
required; the time SHALL be optional and disabled until a date is chosen. A date
without a time SHALL mean 00:00:00.000 UTC of that date. The browser SHALL send the
canonical UTC string `YYYY-MM-DDTHH:mm:ss.sssZ`; backend validation, normalization
and stored values SHALL remain unchanged. An existing instant SHALL be shown as its
UTC date and time, with seconds and milliseconds when nonzero, and SHALL be sent
unchanged when the owner does not edit it. No such control SHALL ask the owner to
type ISO text or a time-zone offset. Associated guidance SHALL state that an omitted
time means 00:00 UTC. CSV timestamp format settings are excluded.

#### Scenario: DATE-1-A Date only
- **GIVEN** the trade form
- **WHEN** the owner picks 13.06.2025 in «Дата сделки» and leaves the time empty
- **THEN** the draft instant is `2025-06-13T00:00:00.000Z`

#### Scenario: DATE-1-B Date and UTC time
- **GIVEN** the trade form with 13.06.2025 chosen
- **WHEN** the owner enters 14:30 in «Время сделки, UTC»
- **THEN** the draft instant is `2025-06-13T14:30:00.000Z`
- **WHEN** the owner clears the time
- **THEN** the draft instant returns to `2025-06-13T00:00:00.000Z`

#### Scenario: DATE-1-C Exact existing instant
- **GIVEN** a draft instant `2024-02-29T01:02:03.004Z`
- **WHEN** the form renders
- **THEN** the date input shows 2024-02-29 and the time input shows 01:02:03.004
- **AND** changing only the date to 2024-03-01 yields `2024-03-01T01:02:03.004Z`

#### Scenario: DATE-1-D No ISO text boxes remain
- **GIVEN** the trade, swap, reward, transfer, carry-in, opening, journal-start, analytics, selected-accounts, price, period and flow forms
- **WHEN** the owner reads their instant controls
- **THEN** each is a date input with an optional UTC time input and none asks for ISO text or an offset

### Requirement: DATE-2 Today by default for account analytics
The system SHALL initially select today's UTC date (00:00 UTC) in account valuation
on a date, the accounting snapshot on a date and the selected-accounts valuation.
Valuation history SHALL initially select the period from seven days before today to
today, both at 00:00 UTC. Manual price entry SHALL initially select today, including
after another instrument is selected, and new trade, swap, reward, journal-start and
opening drafts SHALL start at today 00:00 UTC instead of the current second. Defaults SHALL NOT start a request; the owner still submits
explicitly, and editing a default keeps the existing invalidation behavior.

#### Scenario: DATE-2-A Value the account today
- **GIVEN** the account valuation form on 2026-10-04
- **WHEN** it first renders
- **THEN** «Дата оценки» shows 2026-10-04, no request has been sent
- **WHEN** the owner presses «Рассчитать стоимость»
- **THEN** the valuation is requested at `2026-10-04T00:00:00.000Z`

#### Scenario: DATE-2-B Last seven days of history
- **GIVEN** the valuation history form on 2026-10-04
- **WHEN** the owner presses «Показать историю» without editing
- **THEN** the series is requested from `2026-09-27T00:00:00.000Z` to `2026-10-04T00:00:00.000Z`
