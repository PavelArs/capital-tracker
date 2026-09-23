## ADDED Requirements

### Requirement: OPEN-001 Private manual accounts and instrument identity
The system SHALL provide owner-scoped manual accounts and manual UUID instrument
identities with duplicate labels allowed. Labels MUST NOT imply fiat, chain or provider
identity. Empty accounts SHALL show revision 0 and no opening. All routes SHALL retain
full-owner session/CSRF protection, parameterized owner-scoped access and no provider calls.

#### Scenario: OPEN-001-A Exact manual opening survives a real restart
- **GIVEN** an owner logged in through actual password and MFA forms
- **WHEN** the owner creates a manual account and opening positions through Russian protected pages
- **THEN** quantity 9007199254740993.000000000000000001 with known total USD cost 123.450000000000000001 and quantity 0.000000000000000001 with unknown cost survive API/PostgreSQL/restart/reload exactly as strings
- **AND** legacy financial rows remain unchanged and accounting page/API operations make no provider requests before or after restart
- **AND** the retained startup price warmup is measured separately as exactly one existing BTC/ETH CoinGecko request per restarted backend, without attributing it to accounting operations

#### Scenario: OPEN-001-B Identity and bounded discovery remain explicit
- **WHEN** two instruments share a symbol and one instrument is reused across two manual accounts
- **THEN** distinct UUIDs remain distinct and accounts retain separate positions without automatic aggregation
- **AND** current and historical position responses include immutable owner-scoped instrument names/symbols even beyond the first instrument page
- **AND** empty accounts remain usable and account/instrument lists use exclusive UUID pagination default 50 / max 100 with no unbounded nested history

### Requirement: OPEN-002 Exact values and explicit coverage
Quantities/costs SHALL use numeric(78,30) and canonical plain decimal API strings,
finite positive quantity and finite nonnegative known total USD cost. SQL constraints
SHALL explicitly reject numeric NaN and both infinities, including direct writes. Unknown cost SHALL pair status
unknown with literal null; known zero MUST remain distinct. The system MUST reject
raw numbers/coercion, invalid grammar, overflow or excess scale before storage.
All declared JSON string fields MUST preserve and validate raw types before implicit
conversion, including malicious object/array values; expectedRevision remains a raw
JSON integer. Accepted UUIDv4 strings SHALL normalize to lowercase hyphenated form
before equality, request identity, ordering and duplicate-instrument checks.
Explicit-offset valid Gregorian asOf SHALL normalize to UTC millisecond precision,
years 1970..9999, with optional 1..3 fractional digits. Coverage MUST NOT imply purchase
time, external contribution, complete acquisition history, valuation or return.

#### Scenario: OPEN-002-A Unknown and known zero are visibly different
- **WHEN** positions have unknown cost and known total USD cost 0
- **THEN** API/UI retain null versus string 0 with distinct completeness labels
- **AND** neither position receives an invented acquisition date, market value or profit

#### Scenario: OPEN-002-B Invalid raw values never round or partially commit
- **WHEN** a request contains raw numeric/array/object amounts, exponent/comma/whitespace/NaN forms, over 48 integer digits, over 30 fractional digits, zero quantity, invalid cost pairing, invalid calendar date, missing offset or over 3 time fractional digits
- **THEN** it returns 400 without partial accounting writes or coercion
- **AND** direct PostgreSQL NaN/Infinity quantity or known-cost inserts are rejected by schema constraints
- **AND** exact boundary strings and valid explicit offsets roundtrip canonically without JavaScript floating-point amount conversion

### Requirement: OPEN-003 Atomic idempotent opening revisions
Creation requests SHALL require UUIDv4 requestId with owner-scoped resource uniqueness.
Same canonical payload SHALL return original 200, new creation 201, conflicting payload 409.
Opening request keys SHALL be unique per owner/account/requestId. Owner foreign keys
SHALL reference users rather than the removable singleton binding. Opening requests
SHALL contain a raw JSON integer expectedRevision and 1..100 distinct owned instruments.
The system SHALL serialize on the account, replay an existing request before CAS,
atomically append the complete next snapshot and update current pointer, preserving
all old revisions. Replay MUST NOT rewind the pointer. No DELETE SHALL be exposed.

#### Scenario: OPEN-003-A Retries and competing replacements preserve provenance
- **WHEN** identical requests race, changed payload reuses a key, or different keys race on one expectedRevision
- **THEN** identical retries create one snapshot, changed payload 409, and competing replacements have exactly one 201 and one 409
- **AND** replaying an old request after a newer revision returns its original snapshot 200 without changing the current pointer
- **AND** decimal-zero normalization, equivalent UTC offsets and reordered positions replay the same canonical request, while rejected batches consume no request key
- **AND** uppercase UUID spellings replay equivalently, but mixed-case duplicate instrument IDs in one positions array return 400
- **AND** string/boolean/object expectedRevision values return 400 before coercion
- **AND** account-creation replay retains its original id/name/createdAt while reporting the live currentRevision without moving its pointer
- **AND** old rows remain identical and a failed position leaves no partial snapshot or pointer update
- **AND** an actual deferred commit failure returns safe generic 500 with accounting rows and request identity rolled back, without private values in logs
- **AND** rollback assertions permit only the preceding valid private-session lastSeenAt touch outside the accounting transaction

#### Scenario: OPEN-003-B History and empty initialization are bounded
- **WHEN** an empty account receives expectedRevision 0 or saved history is requested
- **THEN** initialization creates revision 1 and replacements contain the entire position set rather than adding quantities
- **AND** descending history uses exclusive revision cursor default 10 / max 20, at most 100 positions per snapshot

### Requirement: OPEN-004 Owner isolation and data-preserving extension
New accounting state SHALL start empty in additive migration 13 and preserve prior
owner/MFA/session/request-admission/financial rows. No legacy balance SHALL be converted
to an acquisition or zero-cost position. Inputs SHALL reject mass assignment and unsafe
types; names SHALL render as text and sensitive position data SHALL NOT enter logs.

#### Scenario: OPEN-004-A Real security failures preserve accounting data
- **WHEN** anonymous/pending clients access new routes, a full owner sends invalid Origin/CSRF, or a request names a foreign account/instrument
- **THEN** responses are 401, 403 or generic 404 respectively, without accounting/financial mutation or identity disclosure
- **AND** ownerId/server-field mass assignment returns 400 and untrusted labels render as text
- **AND** accounting failures show Russian page feedback without duplicate raw-English global toasts, while existing 401 redirects and 403 CSRF handling remain intact

#### Scenario: OPEN-004-B Populated predecessor remains unchanged
- **GIVEN** a populated twelve-migration synthetic schema including live request limits and factor/session classes
- **WHEN** actual migration 13 and replay run
- **THEN** every prior row/schema remains identical, new accounting tables start empty, and replay changes nothing
- **AND** all retained financial/authentication assertions and unsafe historical migration refusals remain enforced
