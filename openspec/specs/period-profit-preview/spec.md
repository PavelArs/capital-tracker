# period-profit-preview Specification

## Purpose
Preview the owner's exact USD profit for a chosen period from reviewed manual valuations and external flows, without storing it.
## Requirements
### Requirement: PROFIT-1 Exact manual valuation profit

The system SHALL calculate a non-persisted USD profit preview as closing value minus opening value minus period contributions plus period withdrawals. Inputs SHALL be explicitly reviewed nonnegative decimal strings under existing 48 integer / 30 fractional digit limits, including zero. Output amounts SHALL be exact canonical strings; derived profit SHALL support negative values and totals wider than input precision. It SHALL NOT infer prices, cost, cash balance, percentages or returns.

#### Scenario: PROFIT-CAPITAL New capital is not profit
- **GIVEN** opening value 1000, closing value 2000 and one included external contribution of 1000
- **WHEN** the reviewed preview is requested
- **THEN** profit is exactly `0`, contributions `1000` and withdrawals `0`.

#### Scenario: PROFIT-EXACT Withdrawals, losses and precision
- **GIVEN** a zero-flow period or a period with exact contributions and withdrawals
- **WHEN** reviewed zero/positive valuations and amounts down to 0.000000000000000000000000000001 are calculated
- **THEN** no rounding occurs, loss is signed, zero remains `0`, and contributions greater than 48 integer digits produce the full exact signed profit.

### Requirement: PROFIT-2 One owner-scoped effective period snapshot

The system SHALL read the current owner's journal coverage, revision and complete effective flow set in one read-only repeatable-read PostgreSQL snapshot. The interval SHALL be `[from,to)` with opening/closing values immediately before flows at each respective boundary. Corrections SHALL restate the preview and voids SHALL be excluded. No pagination or unrelated household/accounting records SHALL affect totals. Results SHALL identify manual USD valuations, owner-declared unreconciled flows, period, supplied valuations, coverage and journal revision. Absent origin or a start before coverage SHALL produce 409, never a zero-flow success.

#### Scenario: PROFIT-PERIOD Complete bounded interval
- **GIVEN** more than one default page of current flows, flows before/from/within/to/after the period, a correction and a void
- **WHEN** a preview is calculated
- **THEN** all and only effective flows in `[from,to)` contribute exactly once, and a subsequent preview reflects accepted corrections.

#### Scenario: PROFIT-SNAPSHOT Concurrent correction and read-only behavior
- **GIVEN** a preview paused after its first PostgreSQL journal read
- **WHEN** another connection commits a flow correction before the head read resumes
- **THEN** the preview returns the old consistent revision/totals, the next preview returns the new revision/totals, and preview itself changes no accounting rows.

#### Scenario: PROFIT-COVERAGE Missing or insufficient journal
- **GIVEN** no reviewed journal or a selected start before its coverage
- **WHEN** the owner requests a preview
- **THEN** response is 409 and no preview or journal is saved.

### Requirement: PROFIT-3 Strict private calculation boundary

POST `/accounting/portfolio/profit-preview` SHALL require the existing owner session, completed MFA, CSRF and origin rules and return private no-store data. It SHALL accept only `from`, `to`, `openingValueUsd`, `closingValueUsd`, `assertReviewed:true`. Dates SHALL use the existing explicit-zone UTC instant rules with positive duration. Invalid amounts including negative/number/exponent inputs, missing review, unknown fields and invalid dates SHALL return 400. Owner identity SHALL come only from authentication; foreign rows SHALL neither influence totals nor appear in results.

#### Scenario: PROFIT-INPUT Strict manual inputs
- **GIVEN** invalid, incomplete, unreviewed, out-of-range or extra-field requests
- **WHEN** the endpoint receives them
- **THEN** it rejects them without storing or silently converting values; equivalent valid zones/leading zeros canonicalize consistently.

#### Scenario: PROFIT-PRIVATE Authenticated owner only
- **GIVEN** anonymous/pending-MFA clients, missing CSRF, invalid origin, or another owner's stored flows
- **WHEN** preview requests are attempted
- **THEN** established security denials apply and successful owner calculations remain private, no-store and unaffected by foreign data.

### Requirement: PROFIT-4 Honest Russian preview interface

The protected Russian interface SHALL expose manual total USD opening/closing values, UTC boundaries, an explicit reviewed assertion and the formula. It SHALL disclose temporary results, manual valuation basis and unreconciled flow completeness; show exact submitted values, period, journal revision and profit; and link to flow setup/review. It SHALL clear displayed results on editing, loading, errors or lost authentication, reset review on editing, ignore outdated replies, and require explicit submission. It SHALL NOT persist drafts/results in browser storage or automatically calculate on page load.

#### Scenario: PROFIT-UI Owner calculates and revises
- **GIVEN** real password/MFA authentication and a reviewed journal containing a 1000 contribution
- **WHEN** the owner enters opening 1000/closing 2000 and confirms review
- **THEN** the Russian page displays exact zero profit, the manual/unreconciled labels, period and revision; editing the values clears the result and requires renewed review.

#### Scenario: PROFIT-LATE In-flight result cannot replace edited input
- **GIVEN** an actual preview response delayed in delivery
- **WHEN** the owner edits an input before that response arrives
- **THEN** the old preview stays hidden, and only a new explicitly reviewed calculation can display a result; failed calculation also leaves no prior result visible.
