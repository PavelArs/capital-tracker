## MODIFIED Requirements

### Requirement: HIST-001 Restated exact account snapshots
The system SHALL reconstruct account positions and cumulative FIFO journal totals at
an explicit UTC instant from current effective, non-void trade versions and the
immutable baseline. It SHALL include all executions at or before that instant,
calculate the complete prefix before pagination, aggregate positive remaining lots
by instrument UUID, and return exact canonical decimal strings. It SHALL identify
the selected instant, coverage, current journal revision and current-effective-history
basis. Corrections and voids SHALL restate the result without changing old receipts.

The effective history SHALL include recorded transfers at or before the selected instant, only
from their arrival instant onward, and order them with same-instant account events by explicit
chronology unique within each touched account. A transfer SHALL move position and basis without
adding covered purchases, sales, realized gain or external flows. The selected account result
SHALL reflect the complete connected replay.

Effective reward versions SHALL be included as acquisition events at inclusive UTC instants, with exact quantity and independently nullable basis. Positions with missing cost SHALL expose knownCostSubtotalUsd and unknownCostQuantity; no receipt income SHALL substitute for price or basis.

#### Scenario: HIST-001-A Purchases, sale and amount correction
- **GIVEN** empty coverage2025-01-01T00:00:00Z, buy1/cost100 onJan2, buy1/cost200 onJan3 and sale1.5/gross450 onJan4, all at00:00:00Z with zero fees
- **WHEN** the owner reads2025-01-02T23:59:59.999Z,2025-01-03T00:00:00Z and2025-01-04T00:00:00Z
- **THEN** position quantity/cost is respectively1/100,2/300 and0.5/100, and cumulative realized gain is0,0 and250 with consumed cost200 atJan4
- **WHEN** the first buy is corrected to120 and the same instants are read again
- **THEN** their costs are120,320 and100, Jan4 realized gain is230, the new journal revision is explicit, and original command receipts are byte-for-byte unchanged

#### Scenario: HIST-001-B Effective time, voids and exact amounts
- **GIVEN** valid effective history containing fees, partial lots and values finer than binary floating-point precision
- **WHEN** a buy correction moves it across a queried boundary without invalidating later sales, or a covered sale is voided
- **THEN** each snapshot uses the corrected execution time and excludes void heads, preserves exact fee/partial-lot allocation, and does not use version creation time as execution time
- **AND** for the HIST-001-A trades with the first buy already corrected to120, voiding the sale restores quantity2/cost320 and realized0; neither correction nor read changes the immutable baseline or old receipts

#### Scenario: TRANSFER-HIST-EFFECTIVE Transfer is inclusive without synthetic trade totals
- **GIVEN** a lot is moved between two covered accounts exactly at a queried instant and a later sale
  consumes part of it
- **WHEN** both account histories are read at that instant and after the sale
- **THEN** the source is reduced and recipient increased at the inclusive boundary with original
  basis/provenance, while trade and external-flow totals are unchanged; a read before arrival
  excludes the received lot

#### Scenario: REWARD-HIST-PREFIX
- **WHEN** a query is before, at or after a reward receipt and subsequent partial sale
- **THEN** quantity follows the full effective prefix; unknown cost stays null and later correction restates history

### Requirement: HIST-002 Explicit accounting coverage and baseline
The system SHALL distinguish an initialized empty journal and known-cost carry-in
from absent coverage. It SHALL reject pre-coverage and uninitialized-journal reads
with409 rather than inventing zero holdings or unknown acquisition costs. At coverage
the baseline SHALL precede all executions at that instant. Initial carried cost SHALL
be returned separately and SHALL NOT become covered buy totals or external flows.

An unknown reward cost within an already initialized journal SHALL NOT invalidate known quantity coverage. This does not permit unknown-cost opening snapshots to become carry-in or guess their acquisition dates.

#### Scenario: HIST-002-A Carry-in at the inclusive boundary
- **GIVEN** a known-cost origin at2025-01-01T00:00:00Z with two original lots1/100 and1/200
- **WHEN** the owner reads at coverage before adding any covered trades
- **THEN** quantity is2, cost and initial cost are300, all covered buy/sale/realized totals are0, and the origin/opening revision is explicit
- **WHEN** a sale1.5/gross450 is recorded exactly at coverage and the same instant is read
- **THEN** quantity is0.5, remaining cost100, realized250, initial cost300 and covered buy totals0
- **AND** one millisecond before coverage is409; a partial original lot4/cost2 atoms/remaining3 retains subsequent allocation1,0,1 instead of rebasing

#### Scenario: HIST-002-B Known zero and unavailable history
- **GIVEN** an initialized empty journal, a valid zero-cost carry-in journal and an account with only unknown-cost opening positions
- **WHEN** the owner requests each at its opening/coverage instant
- **THEN** the first returns empty positions and exact zero totals, the second returns its actual positive quantity and zero cost, and the third returns409 without initializing a journal or guessing cost

#### Scenario: REWARD-HIST-COVERAGE
- **WHEN** an initialized journal receives an unknown-basis reward
- **THEN** history returns its actual quantity with null cost while an uninitialized unknown-cost opening still returns409

### Requirement: HIST-003 Bounded coherent pages
The system SHALL expose only the allowlisted query and response in the design. It
SHALL use one caller-owned read-only REPEATABLE READ transaction for every database
read in a response, preserve existing journal bounds, sort positions by canonical
instrument UUID and require a pinned journal revision for nonzero offsets. Supplied
revision mismatch SHALL return409. Summary and initial cost SHALL describe the whole
selected prefix even when the requested page is empty.

A historical response SHALL load the connected ledger once inside its single read-only
REPEATABLE READ transaction. Its revision pin SHALL cover the connected history on which the
selected account result depends; an upstream trade, CSV or transfer change SHALL invalidate a
continuation for that account. Derived position offsets SHALL accept0..99999 with
limit1..100 and the same revision-pin rules, without truncating connected positions.

Reward versions SHALL load once with the connected ledger in the same snapshot; reward corrections SHALL invalidate every affected historical page pin.

#### Scenario: HIST-003-A Pagination preserves identity and totals
- **GIVEN** two different instruments with the same symbol, each having remaining lots, and limit1
- **WHEN** the owner requests the first and pinned next page at the same instant
- **THEN** each UUID appears exactly once in ascending order, both pages carry identical complete totals and initial cost, and the last nextOffset is null
- **AND** a valid offset beyond all positions returns empty items with those same totals; a continuation without revision is400
- **WHEN** a trade changes between those page requests
- **THEN** the old pinned continuation is409 rather than a mixed financial snapshot

#### Scenario: HIST-003-B Concurrent read and supported maxima
- **GIVEN** real PostgreSQL and a paused read after establishing its snapshot
- **WHEN** a competing correction commits before the read loads all heads/baseline/labels
- **THEN** the response is wholly the old state and revision; a new read is wholly the committed state
- **AND**100 carry-in lots plus1000 active trades remain calculable with82-digit derived bounds, without an early query/page limit or numeric rounding

#### Scenario: TRANSFER-HIST-PIN Upstream edit invalidates dependent history page
- **GIVEN** a recipient history page is pinned while its position depends on a source lot transferred from
  another account
- **WHEN** an upstream source correction commits after the first page
- **THEN** the old recipient continuation returns409 rather than mixing revisions, and an explicit new read
  uses one complete connected snapshot
- **AND** a connected result containing1101 distinct instrument positions can read its final position
  at pinned offset1100 with limit1; a valid offset99999 is empty with complete unchanged totals

#### Scenario: REWARD-HIST-PIN
- **WHEN** a concurrent upstream reward correction overlaps a connected historical read
- **THEN** the snapshot is wholly old or new; stale continuation returns409
