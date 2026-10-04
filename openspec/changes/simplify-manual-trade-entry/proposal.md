## Why

The owner wants to record a purchase or sale by hand as simply as a spreadsheet row:
asset, buy or sell, day, quantity, total paid. The current trade form also demands a
"same-instant order" integer and uses accounting jargon. Since dates became
calendar days (`simplify-date-entry`), every date-only entry lands at 00:00 UTC with
order 0, so a second purchase on the same day is refused with a generic 409.

## What Changes

- A trade create or correction MAY omit `orderWithinTimestamp`. The backend then
  places the trade after every event already recorded at that instant in the account
  (trades, rewards, swaps and transfers touching it): the highest occupied order plus
  one, or 0. Replays of the same request ID stay idempotent because the canonical
  payload records the order as automatic (`null`). An explicit order keeps today's
  behavior and conflicts.
- The trade form asks for instrument, buy/sell, date (time optional), quantity and
  the total amount in USD. The fee is optional (empty means 0). The order moves into
  a collapsed «Порядок в один момент» disclosure whose summary shows «авто» or the
  explicit number; new drafts leave it empty (automatic). A correction keeps the
  trade's existing order.
- Plain wording: «Сумма сделки, USD» replaces «Валовая сумма, USD», with guidance
  that switches between paid (buy) and received (sell). Sections read «Что и когда»
  and «Сколько». A saved trade is confirmed in words («Сделка сохранена: покупка
  0.01 BTC на 1170 USD, 11.07.2025.») instead of UUIDs and revisions.
- `TradeForm` accepts optional `lockedFields` so a prefilled draft (for example an
  address-imported transaction) can keep chosen fields read-only.

## Capabilities

### Modified Capabilities
- `usd-fifo-trades`: TRADE-002 allows an omitted same-instant order on trade commands.
- `trade-workbench`: WORKBENCH-001 describes the plain grouping, optional fee and order.

## Impact

Backend: `trade-input.ts` (optional order), `trade.service.ts` (resolve the automatic
order under the existing account lock) and a pure helper. No migration, schema,
stored-row or dependency change; existing rows and explicit-order requests are
unchanged. Frontend: `TradeForm`, `TradeJournal` (command, receipt text), the trades
API type, unit tests and Playwright cases that use the renamed amount label or the
order field.

Non-goals: a purchase currency other than USD (thread «Валюта покупки»), completing
address-imported transactions (wallet-address thread), automatic order for swaps,
rewards or transfers, and reformatting result tables.
