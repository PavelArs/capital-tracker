## ADDED Requirements

### Requirement: OPEN-001 Private manual accounts and instrument identity
The system SHALL provide owner-scoped manual accounts and manual UUID instrument
identities with duplicate labels allowed. Labels MUST NOT imply fiat, chain or provider
identity. Empty accounts SHALL show revision0 and no opening. All routes SHALL retain
full-owner session/CSRF protection, parameterized owner-scoped access and no provider calls.

#### Scenario: OPEN-001-A Exact manual opening survives a real restart
- **GIVEN** an owner logged in through actual password and MFA forms
- **WHEN** the owner creates a manual account and opening positions through Russian protected pages
- **THEN** quantity9007199254740993.000000000000000001 with known totalUSDcost123.450000000000000001 and quantity0.000000000000000001 with unknown cost survive API/PostgreSQL/restart/reload exactly as strings
- **AND** legacy financial rows and provider request counts remain unchanged

#### Scenario: OPEN-001-B Identity and bounded discovery remain explicit
- **WHEN** two instruments share a symbol and one instrument is reused across two manual accounts
- **THEN** distinct UUIDs remain distinct and accounts retain separate positions without automatic aggregation
- **AND** empty accounts remain usable and account/instrument lists use exclusive UUID pagination default50/max100 with no unbounded nested history

### Requirement: OPEN-002 Exact values and explicit coverage
Quantities/costs SHALL use numeric(78,30) and canonical plain decimal API strings,
positive quantity and nonnegative known totalUSDcost. Unknown cost SHALL pair status
unknown with literal null; known zero MUST remain distinct. The system MUST reject
raw numbers/coercion, invalid grammar, overflow or excess scale before storage.
Explicit-offset valid Gregorian asOf SHALL normalize to UTC millisecond precision,
years1970..9999, with optional1..3 fractional digits. Coverage MUST NOT imply purchase
time, external contribution, complete acquisition history, valuation or return.

#### Scenario: OPEN-002-A Unknown and known zero are visibly different
- **WHEN** positions have unknown cost and known totalUSDcost0
- **THEN** API/UI retain null versus string0 with distinct completeness labels
- **AND** neither position receives an invented acquisition date, market value or profit

#### Scenario: OPEN-002-B Invalid raw values never round or partially commit
- **WHEN** a request contains raw numeric/array/object amounts, exponent/comma/whitespace/NaN forms, over48 integer digits, over30 fractional digits, zero quantity, invalid cost pairing, invalid calendar date, missing offset or over3 time fractional digits
- **THEN** it returns400 without partial accounting writes or coercion
- **AND** exact boundary strings and valid explicit offsets roundtrip canonically without JavaScript floating-point amount conversion

### Requirement: OPEN-003 Atomic idempotent opening revisions
Creation requests SHALL require UUIDv4 requestId with owner-scoped resource uniqueness.
Same canonical payload SHALL return original200, new creation201, conflicting payload409.
Opening requests SHALL contain expectedRevision and1..100 distinct owned instruments.
The system SHALL serialize on the account, replay an existing request before CAS,
atomically append the complete next snapshot and update current pointer, preserving
all old revisions. Replay MUST NOT rewind the pointer. No DELETE SHALL be exposed.

#### Scenario: OPEN-003-A Retries and competing replacements preserve provenance
- **WHEN** identical requests race, changed payload reuses a key, or different keys race on one expectedRevision
- **THEN** identical retries create one snapshot, changed payload409, and competing replacements have exactly one201 and one409
- **AND** replaying an old request after a newer revision returns its original snapshot200 without changing the current pointer
- **AND** old rows remain identical and a failed position leaves no partial snapshot or pointer update

#### Scenario: OPEN-003-B History and empty initialization are bounded
- **WHEN** an empty account receives expectedRevision0 or saved history is requested
- **THEN** initialization creates revision1 and replacements contain the entire position set rather than adding quantities
- **AND** descending history uses exclusive revision cursor default10/max20, at most100 positions per snapshot

### Requirement: OPEN-004 Owner isolation and data-preserving extension
New accounting state SHALL start empty in additive migration13 and preserve prior
owner/MFA/session/request-admission/financial rows. No legacy balance SHALL be converted
to an acquisition or zero-cost position. Inputs SHALL reject mass assignment and unsafe
types; names SHALL render as text and sensitive position data SHALL NOT enter logs.

#### Scenario: OPEN-004-A Real security failures preserve accounting data
- **WHEN** anonymous/pending clients access new routes, a full owner sends invalid Origin/CSRF, or a request names a foreign account/instrument
- **THEN** responses are401,403 or generic404 respectively, without accounting/financial mutation or identity disclosure
- **AND** ownerId/server-field mass assignment returns400 and untrusted labels render as text

#### Scenario: OPEN-004-B Populated predecessor remains unchanged
- **GIVEN** a populated twelve-migration synthetic schema including live request limits and factor/session classes
- **WHEN** actual migration13 and replay run
- **THEN** every prior row/schema remains identical, new accounting tables start empty, and replay changes nothing
- **AND** all retained financial/authentication assertions and unsafe historical migration refusals remain enforced
