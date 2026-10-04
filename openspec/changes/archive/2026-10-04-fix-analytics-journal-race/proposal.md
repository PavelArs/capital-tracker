## Why

Main CI run 37218384482 failed VAL-UI: the valuation read answered 200 with the
expected incomplete snapshot, but the "Оценка счёта на дату" section stayed empty.
The same tree passed VAL-UI on PR run 37218242193. The analytics tools are usable
while the trade journal is still loading (`journalRevision` null). When the journal
loads after the owner pressed "Рассчитать стоимость", the revision change from unknown
to known invalidates the in-flight read and its result is silently dropped. The owner
can hit this by acting quickly after opening an account.

## What Changes

- Account valuation, valuation history and the accounting snapshot keep a read that
  was requested while the journal was loading when the read was computed at the
  revision that then loaded; a read computed at another revision is dropped as before.
- The journal becoming known for the same account no longer counts as a revision
  change. An account switch or a change between known revisions still invalidates
  pending and shown results.

## Capabilities

### Modified Capabilities
- `account-analytics`: ANALYTICS-003 gains the loading-journal scenario.

## Impact

Frontend only (`HistoricalValuation`, `ValuationHistory`, `HistoricalAccounting` and a
shared helper). No API, schema or server change.
