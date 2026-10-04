## Context

Nineteen controls across twelve screens took an instant as free ISO text. The
backend accepts only explicit-offset Gregorian instants and normalizes them to
`YYYY-MM-DDTHH:mm:ss.sssZ`; the frontend passes the text through unchanged.

## Decisions

- **One stateless component.** `DateTimeField` takes and emits the canonical UTC
  string, so each form keeps its existing state, invalidation, review, lock and
  retry logic. It derives the native date and time values from that string and
  combines them back; nothing else in a form changes type.
- **UTC, not local time.** The journal, imports and exact-instant price matching
  are all UTC; the owner's imported purchases sit at 00:00 UTC. Entering local
  time would silently shift dates across midnight for an owner in UTC+3.
- **Midnight is "no time".** The time input is empty for 00:00:00.000, so a
  date-only workflow never shows a time. Seconds/milliseconds are shown only when
  present, and the input `step` follows the shown precision so native validation
  accepts exact existing instants.
- **Unique time labels per page.** Each time input names its purpose («Время
  сделки, UTC»), because hidden analytics panels stay mounted next to the forms and
  tests and assistive technology need unambiguous names.
- **Defaults are dates, not requests.** Analytics start at today (history: last
  seven days) but still wait for the explicit button press required by existing
  specs.

## Risks

- Native date inputs cannot hold invalid text, so client-side "invalid date"
  paths become unreachable from the UI; backend validation and API-level tests are
  unchanged.
- A browser without native date/time inputs falls back to text inputs that accept
  `YYYY-MM-DD` and `HH:mm`; current Chrome, Safari and Firefox support both.

## Rollback

Revert the frontend commit. No data, API or schema depends on it.
