# External USD cash flows

This slice records explicit contributions to and withdrawals from the owner's
tracked portfolio. It keeps investor cash flows separate from investment operations:
a trade, swap, transfer between owned accounts, opening holding, reward, fee or
in-kind movement does not become an external cash flow automatically. Creating a
record also does not move money or change account balances.

The owner starts the journal by choosing a coverage instant and confirming
“Я проверил границу учёта”. This is a declared reporting boundary, not proof that all
cash movements have been found or reconciled. Older activity is not imported or
inferred. The ledger is explicitly labelled unreconciled; a covered period with no
records means no flows are recorded for that interval, not that no flows occurred.

Each entry is a positive exact USD amount, a date and time with an explicit time-zone
offset, a direction (“Ввод” or “Вывод”), and an explicit confirmation that the USD
crossed the portfolio boundary. Periods use `[from, to)`: the start is included and
the end is excluded. Dates are normalized to UTC. The displayed contribution,
withdrawal and net contribution totals describe the recorded entries in that period.

Corrections append a new immutable version and restate current period totals. Voiding
is terminal: it removes the entry from current totals while preserving its history.
Exact retries of an accepted command return its original receipt rather than adding a
duplicate. Distinct legitimate entries with the same date and amount remain distinct.
The journal supports up to1000 active entries and10000 versions. Pages are bounded;
continuations pin the journal revision, and a stale continuation requires an explicit
refresh.

The Russian UI labels the review page “Внешние денежные потоки”. Entry
requires separate confirmation of the coverage boundary and each external USD flow.
The UI retains a pending command for explicit retry after an uncertain
response; it does not automatically post a retry or store pending commands in browser
storage. In-memory recovery ends on a full page reload, after which saved entries
remain discoverable from the journal.

This ledger does not calculate portfolio wealth, cash balances, investment profit,
XIRR or TWR. Withdrawals can exceed recorded contributions because opening wealth and
cash balances are outside this slice. It does not reconcile bank or blockchain
observations, convert non-USD amounts, or classify rewards, fees, internal transfers
or in-kind events. These boundaries must be settled before such operations can be
counted safely.

Storage is additive migration17: it creates an owner-scoped journal and immutable
version rows without rewriting or backfilling prior accounting, authentication,
trade, opening or import data. No production migration or deployment is authorized.
See the [active verification record](../openspec/changes/record-external-usd-flows/verification.md)
for the current checks, evidence and explicitly unrun work.
