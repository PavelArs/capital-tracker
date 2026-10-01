# conventional-xirr-preview Specification

## Purpose
Provide a private, bounded annualized-return preview from reviewed manual USD valuations and complete dated external flows, with exact cash-flow preparation and explicit numerical limitations.
## Requirements
### Requirement: XIRR-1 Exact dated investor cash flows

The system SHALL prepare XIRR cash flows from negative manual opening, negative external contributions, positive withdrawals and positive terminal value. It SHALL reuse complete effective owner flows and existing reviewed input/coverage/UTC `[from,to)` semantics, aggregate identical millisecond instants exactly and discard only exact-zero buckets. Money SHALL never pass through JavaScript floating-point amounts. Existing profit behavior SHALL remain unchanged.

#### Scenario: XIRR-YEAR Required ten percent example
- **GIVEN** opening0, an external contribution1000 at2025-01-01T00:00:00Z and closing1100 at2026-01-01T00:00:00Z
- **WHEN** a reviewed preview is calculated
- **THEN** annual decimal rate is approximately0.1 within1e-10, percent approximately10, exact profit100, and the result identifies manual/unreconciled basis and the captured journal revision.

#### Scenario: XIRR-FLOWS Complete effective timing
- **GIVEN** corrected/voided flows, same-instant cancellation, a flow at each boundary and more than one page of eligible records
- **WHEN** XIRR is prepared
- **THEN** all effective eligible flows count once, the upper-bound flow is excluded, zero buckets disappear only after exact aggregation, and millisecond differences are retained.

### Requirement: XIRR-2 Bounded numerically qualified rate

The system SHALL use ACT/365F on UTC milliseconds, approximate rates with absolute annual-decimal-rate tolerance1e-10 and canonical string outputs rounded to12 rate decimals (percent exactly100 times the published rate). Only at least two distinct nonzero instants, both signs and exactly one negative-to-positive transition SHALL qualify. At most64 such instants including valuation boundaries SHALL be solved within inclusive annual rate bounds[-0.999999,1000], at most80 iterations and96 significant decimal precision. It SHALL explicitly return unavailable with null rates and deterministic reason for insufficient/one-sided flows, unsupported pattern, too many dates, out-of-range root or failed numerical qualification. Unsupported patterns SHALL NOT be labeled proven multiple roots. No data SHALL be truncated to satisfy limits.

#### Scenario: XIRR-ORACLES Gains, losses, zeros and precision
- **GIVEN** annual -1000/+1000, -1000/+500 and irregular analytically checked conventional flows, including maximum money precision and tiny time intervals
- **WHEN** supported XIRR is calculated
- **THEN** rates meet the declared rate tolerance, zero/loss signs are correct, no money rounds early and numerical uncertainty never becomes a fabricated rate.

#### Scenario: XIRR-UNAVAILABLE Explicitly unsupported result
- **GIVEN** no effective flows, only negative flows, a -/+/- stream,65 nonzero instants, or a one-day10-percent growth beyond the upper rate bound
- **WHEN** a preview is requested
- **THEN** it returns the corresponding documented unavailable reason and null rates, while exact profit and completeness remain available.

### Requirement: XIRR-3 Private bounded snapshot calculation

The new authenticated POST `/accounting/portfolio/xirr-preview` SHALL return the existing exact profit payload plus XIRR metadata from ONE RR READ ONLY owner snapshot. It SHALL end the database transaction before solving, make no provider calls or financial writes, preserve existing strict400/coverage409 and auth/MFA/CSRF/origin/no-store rules, and allow at most one active XIRR request per backend process with429 for excess requests. The slot SHALL always release after success/failure and computation SHALL yield between bounded batches. Later journal edits SHALL affect only subsequent previews.

#### Scenario: XIRR-SNAPSHOT Concurrent correction and bounded busy state
- **GIVEN** an actual PostgreSQL preview paused after its first journal read
- **WHEN** another connection commits a correction and a second request reaches the same busy service
- **THEN** the second request gets429, the first returns its original coherent revision/rate/profit, and the next request succeeds with corrected data after the slot is released.

#### Scenario: XIRR-PRIVATE No private calculation without full authentication
- **GIVEN** anonymous, pending-MFA, invalid CSRF/origin requests, invalid input, insufficient coverage or foreign-owner flows
- **WHEN** XIRR is requested
- **THEN** established private denials apply, foreign data cannot influence results and no accounting row/provider state changes.

### Requirement: XIRR-4 Honest Russian annualization interface

The existing protected manual-period form SHALL provide an explicit XIRR action alongside profit. It SHALL bind review to unchanged inputs, discard old/late results on edits/new actions/errors/auth loss, and display same-response exact profit/revision plus approximate annual XIRR or a specific unavailable reason. It SHALL disclose manual/unreconciled data, ACT/365F, supported range/date limit and annualization rather than a forecast, with a warning for an effective horizon shorter than365 days. It SHALL NOT persist or auto-submit values.

#### Scenario: XIRR-UI Available and unavailable are distinct
- **GIVEN** a real authenticated owner and reviewed journal
- **WHEN** the owner explicitly requests the annual1000-to1100 example and then a one-day10-percent example
- **THEN** the Russian interface shows approximate10-percent annual XIRR for the first and an out-of-range reason without a numeric placeholder for the second.

#### Scenario: XIRR-LATE Edited inputs supersede delayed calculation
- **GIVEN** an actual XIRR response delayed in delivery
- **WHEN** the owner edits input or starts a newly reviewed profit calculation
- **THEN** the old XIRR response cannot reappear or overwrite the current result; errors also clear previous results and require an explicit retry.
