## ADDED Requirements

### Requirement: FIFO-RANGE-1 Original-coordinate cost conservation
The shared FIFO allocator SHALL represent each held portion by an interval[start,end)
of the original positive quantity Q and nonnegative cost C in exact integer atoms.
Its cost SHALL be floor(C*end/Q)-floor(C*start/Q). Prefix splits SHALL preserve these
original coordinates and SHALL NOT rebase quantity/cost or round intermediate money.

#### Scenario: FIFO-RANGE-PARTITION Nonuniform atom allocation
- **GIVEN** an original quantity7atoms and cost11atoms
- **WHEN** it is partitioned into[0,3),[3,4),[4,7)
- **THEN** exact costs are4,2,5atoms and sum to11
- **AND** repeated splitting of any valid interval preserves its exact original cost

### Requirement: FIFO-RANGE-2 Bounded immutable interval operations
Interval operations SHALL reject nonpositive original quantity, negative cost,
reversed/negative/out-of-original bounds, and nonpositive or oversized prefix takes
using the existing FIFO history error. They SHALL leave input values unchanged and
permit empty resulting remainders with zero cost.

#### Scenario: FIFO-RANGE-BOUNDS Full consumption and invalid prefixes
- **GIVEN** a valid interval and frozen input data
- **WHEN** the entire interval is consumed or an invalid range/take is supplied
- **THEN** full consumption leaves an empty zero-cost remainder without input mutation
- **AND** invalid operations fail without returning fabricated inventory

### Requirement: FIFO-RANGE-3 Preserve existing accounting projections
Existing trade-only and carry-in FIFO DTOs, exact summaries, lot/match provenance,
chronology, capacity and failure behavior SHALL remain unchanged. The refactor SHALL
make no database, endpoint, provider or frontend behavior change.

#### Scenario: FIFO-RANGE-COMPAT Existing trade and carry-in journeys
- **GIVEN** the existing passing trade/carry-in/CSV/history characterization
- **WHEN** FIFO uses interval allocation through the application and PostgreSQL
- **THEN** buying1at100 and1at200 then selling1.5for450 still yields250gain and100remainingcost
- **AND** carry-inQ4/C2atoms/alreadydisposed1 retains the[1,0,1] allocation phase
- **AND** correction, rollback, replay and row-preservation checks still pass
