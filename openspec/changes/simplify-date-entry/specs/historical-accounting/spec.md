## MODIFIED Requirements

### Requirement: HIST-004 Protected Russian read-only review
The system SHALL provide a Russian account-detail snapshot form with calendar-date
instant selection as defined by DATE-1 (optional UTC time) and clear reconstructed-accounting, coverage and revision labels.
It SHALL invalidate results on input/account/observed-revision changes, ignore late
responses, pin continuation parameters and require explicit refresh after conflicts.
It SHALL preserve parent editing state, existing authentication/privacy boundaries,
all business rows and command receipts, and make no external provider request.

#### Scenario: HIST-004-A Actual browser review and stale intent
- **GIVEN** an owner signed in through actual password and MFA, an initialized account and an unsaved selected trade correction
- **WHEN** they submit the historical form and page through its results
- **THEN** the browser shows the exact API quantities/costs with UTC coverage and revision, literal instrument labels and reconstruction caveats, while preserving the unsaved correction
- **WHEN** a real response is delayed and the owner edits the instant or selects another account, or a real pinned continuation returns409 after a concurrent write
- **THEN** no stale or mixed result reappears, the owner can explicitly refresh, and no write is submitted by the historical view

#### Scenario: HIST-004-B Admission, privacy and no mutation
- **GIVEN** actual HTTPS sessions, PostgreSQL row fingerprints and external-provider request counters
- **WHEN** anonymous or MFA-pending clients request history, or the owner uses a foreign account, malformed/duplicate date, unexpected query key or invalid paging value
- **THEN** responses are respectively401,404 or400 with existing private error/no-store behavior and no accounting data exposure
- **WHEN** an admitted owner requests a valid snapshot
- **THEN** accounting rows, current pointers, original receipts and import bytes are unchanged, no provider calls occur, and only documented authenticated session/admission bookkeeping changes
