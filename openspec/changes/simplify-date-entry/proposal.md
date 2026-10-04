## Why

The owner cannot use the analytics or entry screens: every date control is a text
box that demands an ISO 8601 instant with a time-zone offset
(`2025-01-04T00:00:00.000Z`). He thinks in calendar days (his spreadsheet uses
`dd.mm.yyyy`) and his imported purchases are stored at 00:00 UTC of their day.

## What Changes

- One shared control replaces every owner-facing instant text box: a native
  calendar date input (shown in the browser locale, `дд.мм.гггг` in Russian) plus an
  optional time input labelled UTC. A date without a time means 00:00 UTC.
- The control exchanges the canonical UTC string the backend already accepts
  (`YYYY-MM-DDTHH:mm:ss.sssZ`). Existing saved instants, including seconds and
  milliseconds, are shown and resubmitted unchanged.
- Account valuation on a date, accounting snapshot on a date and the
  selected-accounts valuation start at today (00:00 UTC); valuation history starts
  with the last seven days. The owner still presses the button to calculate.
- Field guidance stops asking for ISO/offset text and explains the 00:00 UTC default.
- Affected screens: trade, swap, reward, owned transfer, carry-in lot and opening
  forms; journal start; account valuation, valuation history and accounting
  snapshot; selected-accounts valuation; manual prices; period profit/XIRR/TWR;
  external USD flows.

## Capabilities

### New Capabilities
- `simple-date-entry`: calendar-date plus optional UTC time entry for every owner-facing instant, with today defaults for account analytics.

### Modified Capabilities
- `historical-accounting`: HIST-004 no longer requires explicit ISO instant typing.
- `acquisition-entry`: ENTRY-001 time controls follow `simple-date-entry` labels.

## Impact

Frontend only: a shared `DateTimeField` component and its use in the listed forms,
their unit tests and the Playwright cases that fill or inspect those controls.

Data impact: none. No backend, API, validation, migration, schema, stored row,
provider call or dependency change. Requests carry the same instant format the
backend already normalizes.

Non-goals: displaying result timestamps as `dd.mm.yyyy`, local-time-zone entry,
CSV timestamp settings (they describe file contents), a new trade form, purchase
currencies other than USD, and completing address-imported transactions. Those are
separate changes.
