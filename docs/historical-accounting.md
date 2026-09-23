# Historical account positions

The verified `inspect-historical-accounting` slice adds the Russian account-detail
section “Учётный срез на дату”. Its
[verification record](../openspec/changes/archive/2026-09-23-inspect-historical-accounting/verification.md)
records nine selected HTTPS cases and real PostgreSQL/source checks. The full
140-case browser suite was not rerun under the owner-authorized targeted policy.

Enter an ISO timestamp with a time-zone offset, then explicitly request a snapshot.
The response shows the normalized UTC instant, declared accounting coverage and
current journal revision. It reconstructs quantities and FIFO cost from the current
effective trade versions and any immutable known-cost opening lots. A correction to
an old trade therefore restates the old-date result; voided trades are excluded.
This is not a record of what the application knew at that past time.

Trades at the selected instant are included. Initial lots precede executions at the
coverage boundary and retain their original cumulative allocation coordinates.
Carried cost appears separately from covered purchases. Displayed journal totals
accumulate from coverage through the selected instant. They are not market values,
observed balances, selected-period investment profit or annualized returns.

A missing journal or a date before coverage is unavailable, not zero. A known-zero
cost remains zero with its actual positive quantity. Instruments are identified by
UUID; equal symbols do not merge distinct assets. Current instrument labels are
rendered literally. The entire supported history is calculated before paging:
100 initial lots, 1000 active trades and 10000 versions remain the existing limits.

Editing the instant, switching accounts or observing a changed journal revision
clears the view. Later pages pin the original instant and revision. A concurrent
write can make a continuation conflict; explicitly refresh the snapshot to start
again. Refreshing this section does not submit or reset an unsaved trade correction.
Nothing is automatically persisted in browser storage.

The endpoint uses one read-only PostgreSQL REPEATABLE READ transaction. Historical
review changes no accounting rows, receipts or import bytes and makes no external
provider calls. Normal authenticated session/admission bookkeeping still applies.
No migration, provider, dependency or deployment change is introduced. Price history,
cash-flow classification, performance, baseline amendment and production readiness
remain separate work.
