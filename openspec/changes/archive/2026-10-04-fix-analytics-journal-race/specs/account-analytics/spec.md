## MODIFIED Requirements

### Requirement: ANALYTICS-003 Preserve explicit read and history boundaries
Presentation SHALL retain original authenticated reads, stale-account/revision/date
response rejection, pinned pagination, no-store/private boundaries and financial
effects. Accounting cost SHALL remain distinct from market value; incomplete price
coverage SHALL keep total unavailable with a separate priced subtotal. History SHALL
retain30elapsed-day/31point bounds, complete-only points including zero, no connecting
lines/interpolation, and exact table/tooltips with approximate chart coordinates.

#### Scenario: ANALYTICS-003-A Retain late-response and pinned-result correctness
- **WHEN** a real delayed read arrives after its input changed, or a history continuation encounters a changed journal revision
- **THEN** it cannot replace edited intent or display stale results, and the independent unsaved trade correction remains intact
- **WHEN** the owner explicitly refreshes after a stored price becomes known zero
- **THEN** valuation/history preserve their established exact complete-zero result and actual request/financial/provider invariants

#### Scenario: ANALYTICS-003-B Keep a read requested while the journal loads
- **GIVEN** the owner requests valuation, history or an accounting snapshot before the account's journal revision has loaded
- **WHEN** the journal loads and the read was computed at that revision
- **THEN** the result is shown
- **AND** a read computed at any other revision, or after an account switch, is not shown
