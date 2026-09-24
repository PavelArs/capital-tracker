## ADDED Requirements

### Requirement: TWR-1 Bounded endpoint period return
The system SHALL use all effective owner external flows in `[from,to)`, netted exactly
by UTC millisecond. It SHALL add signed net flow at from to the manual opening value,
exclude flows at to, and count only strictly interior nonzero net-flow instants.
If this count is zero and adjusted opening capital positive, it SHALL calculate
(closing-adjustedOpening)/adjustedOpening as a period return, without annualization.

#### Scenario: TWR-ENDPOINT New starting capital is not investment profit
- **GIVEN** opening0, contribution1000 exactly at from, closing1100 and no interior net flow
- **WHEN** the owner requests a reviewed preview
- **THEN** adjusted opening is1000, profit100, periodRate0.1 and periodPercent10
- **AND** a flow exactly at to is excluded

#### Scenario: TWR-EXACT Cancellation, losses and rounding
- **GIVEN** simultaneous interior equal contribution/withdrawal, or positive adjusted opening with zero closing, or tiny/high-precision valuations
- **WHEN** TWR is requested
- **THEN** exact simultaneous cancellation remains supported, zero closing returns rate-1/percent-100, and money never rounds early
- **AND** the final rate rounds once to12 decimal places, nearest/ties away from zero, with percent exactly100 times the published rate and no negative zero
- **AND** the declared absolute rounding bound5e-13 concerns rate arithmetic only

### Requirement: TWR-2 Explicitly unavailable data
The system SHALL return null rates and reason `missing-flow-boundary-valuations`
when any strictly interior net-flow instant remains, including one atom. Otherwise,
adjusted opening capital <=0 SHALL return `nonpositive-opening-capital`. It SHALL
retain exact profit and snapshot metadata in either unavailable state and SHALL NOT
infer intermediate prices, insert valuations, or approximate missing flow boundaries.

#### Scenario: TWR-GAPS Genuine missing valuations differ from zero return
- **GIVEN** a nonzero intermediate net flow, or no intermediate net flow with adjusted start0/negative
- **WHEN** a preview is requested
- **THEN** the corresponding reason is returned with null rate/percent, while supported flat positive capital returns the string0
- **AND** opposite flows at different milliseconds cannot cancel into a supported period

### Requirement: TWR-3 Private coherent read-only snapshot
POST `/accounting/portfolio/twr-preview` SHALL reuse the existing strict reviewed
profit input and one complete RR READ ONLY owner snapshot, preserving400 invalid
input,409 coverage, authentication/MFA/CSRF/origin/no-store rules. It SHALL return
exact profit plus TWR method, rounding bound, adjusted start, start net and interior
count. It SHALL make no financial write/provider call or truncate flows to a page.

#### Scenario: TWR-SNAPSHOT Corrections affect the next coherent result
- **GIVEN** more than one page of effective flows with corrections/voids and foreign-owner rows
- **WHEN** a second PostgreSQL connection commits a correction while a preview is paused after its first real journal read
- **THEN** the first preview retains its original revision, profit and TWR; the next reflects the correction
- **AND** all eligible owner heads count once, foreign rows have no effect, and preview changes no stored row/provider state

#### Scenario: TWR-API Strict private preview boundary
- **GIVEN** anonymous/password-only clients, invalid CSRF/origin, invalid/unreviewed input or missing coverage
- **WHEN** they request a preview
- **THEN** established denials apply and no TWR data is disclosed
- **AND** a fully authenticated valid owner request returns200, no-store and exact supported or unavailable metadata

### Requirement: TWR-4 Honest Russian period interface
The protected manual period form SHALL provide explicit reviewed TWR calculation,
show same-response exact profit/revision plus a rounded period percent or specific
unavailable message, and disclose manual/unreconciled data and endpoint-only limits.
It SHALL preserve existing profit/XIRR behavior, clear old results on edits/actions/
errors/auth loss and ignore stale replies. It SHALL NOT auto-submit or persist inputs.

#### Scenario: TWR-UI Available, missing and late results
- **GIVEN** real password/MFA authentication and a reviewed journal
- **WHEN** the owner requests the supported0+1000-to1100 example and then a period with an intermediate contribution
- **THEN** the Russian interface shows10 percent for the period, then an explicit missing-valuation message without a numeric placeholder
- **AND** input edits reset review and clear the result
- **AND** an actual response delayed in delivery cannot overwrite edited input or a newer profit result
