# Manual USD price points

> **Screen removed (G1, 2026-10-10).** The Russian browser screen this page describes was removed
> from the application. Accounts are made in Add asset and Add wallet, trades are added in Add
> transaction and the price of a hand-valued asset is changed on its asset page. The wording
> about screens below is historical; the data and API rules still describe the stored records.


Implemented and verified with scoped unit, real PostgreSQL and HTTPS checks.
See the [verification record](../openspec/changes/archive/2026-09-23-record-manual-usd-prices/verification.md).

The **Ручные цены** screen records an owner-reviewed USD price per unit
for an existing manual instrument. Select by its UUID: equal symbols do not mean
the same asset, network, or token. Prices are manual declarations, not verified
provider observations, acquisition costs, or whole-portfolio values.

Each point has a UTC millisecond timestamp and an exact nonnegative decimal
price (up to48 integer and30 fractional digits). Zero is an explicit price;
an absent price remains absent. The points do not establish continuous historical
coverage. No interpolation, last-known carry-forward, automatic valuation or
provider request occurs when reading them.

Saving again at exactly the same normalized instant creates a correction while
preserving the old receipt. **История** shows those versions. **Исключить цену**
creates a reviewed void, removing the point from the effective list without
deleting its history. Repair a wrong timestamp by voiding that point and saving
one at the intended time. The two commands are separate explicit actions. A later
set can restore a voided point.
To inspect an excluded point, enter its timestamp and select
**История указанной даты**; absence from the effective list does not erase history.

Revision conflicts require an explicit refresh and new review. After uncertain
delivery, retry the unchanged command to recover its original receipt; do not
automatically create a new command. A successful save remains successful if its
following refresh fails. Editing or switching instruments invalidates old results.

The book is bounded at10000 total versions per instrument, including corrections
and voids. At that cap new commands are refused; existing identical commands can
still be replayed. The UI and API page current points and immutable history.

The new storage is additive migration18. Existing instruments, positions, trades,
manual profit/XIRR previews and legacy provider caches retain their behavior.
No dependency, external provider, paid service or production deployment is added.

## Focused price workbench

The editor now appears before saved prices and history. **Правила ручных цен**
opens the full identity/correction rules; essential manual and incomplete-coverage
limits stay visible. Field guidance explains instrument UUID, explicit timezone/UTC
and exact nonnegative USD/unit values, including zero.

**Исключить цену** and **История** move keyboard focus to their review area.
Cancel exclusion or **Закрыть историю** returns to the initiating control when it
remains available. Cancelling keeps the date/price draft; closing invalidates late
history responses. History completion does not move focus. Wide saved-price tables
scroll inside a named keyboard-focusable region on narrow screens.

The scoped real save/recovery journey and responsive light/dark review are recorded
in the [workbench verification](../openspec/changes/archive/2026-09-27-redesign-manual-price-workbench/verification.md).
