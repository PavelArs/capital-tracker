## ADDED Requirements

### Requirement: FLOW-UX-001 Focused entry keeps accounting boundaries explicit
The Russian flow page SHALL keep owner-declared, unreconciled USD scope visible and expose full exclusions and tab-memory recovery limits through native keyboard-accessible rules disclosure. Coverage, operation time, positive exact USD amount and half-open period controls SHALL have associated guidance outside their labels. Existing values, validation, explicit initialization/create attestations, correction intent and write locks SHALL remain unchanged.

#### Scenario: FLOW-UX-001-A Declare coverage and record a contribution
- **GIVEN** a real HTTPS password/MFA session with a PostgreSQL-backed uninitialized flow journal
- **WHEN** the owner opens the page
- **THEN** the unreconciled declaration is visible and full rules are initially collapsed but can be opened and closed with the keyboard
- **AND** coverage/date controls explain explicit time-zone/UTC meaning, amount guidance requires a positive USD value, and period guidance explains inclusive start/exclusive end
- **WHEN** the owner explicitly initializes and saves a contribution1000
- **THEN** the exact receipt and period totals remain1000 with no invented account balance or automatic external-provider request

### Requirement: FLOW-UX-002 History actions guide focus without changing intent
Allowed correction, void and version-history actions SHALL focus the corresponding rendered heading without waiting for a network read. Cancellation or closing versions SHALL restore the initiating connected enabled action, otherwise a visible page heading. Version close SHALL invalidate outstanding version reads. Asynchronous reads SHALL NOT move focus or reset unsaved correction values. Selection/cancel/close SHALL NOT send a business write.

#### Scenario: FLOW-UX-002-A Correction and void cancellation return to the row
- **GIVEN** a saved contribution in the period table
- **WHEN** correction is selected
- **THEN** the correction heading receives focus and exact saved values populate the editor
- **WHEN** correction is cancelled or a selected void is cancelled
- **THEN** focus returns to its corresponding row action without another version or write
- **AND** the existing save/void guards, attestation and revision checks remain effective

#### Scenario: FLOW-UX-002-B Version navigation respects later focus and edits
- **GIVEN** an unsaved correction and a real version read with delayed delivery
- **WHEN** the owner selects another flow's versions and then moves to another input
- **THEN** the versions heading was focused immediately, old history is cleared and the later response does not steal focus or alter the correction
- **WHEN** versions are closed
- **THEN** the panel disappears, outstanding reads cannot reopen it and focus returns to the initiating action when available

### Requirement: FLOW-UX-003 Responsive results preserve exact evidence and recovery
Period results SHALL emphasize exact recorded totals, date, direction and USD amount. Complete flow identity SHALL remain selectable through a native disclosure. Period/version tables SHALL have descriptive captions and keyboard-accessible contained scrolling. At360,768and1440pixels in light/dark themes, the page SHALL have no horizontal overflow and main controls SHALL have at least44px height with visible focus/readable text. Receipts, immutable versions, pagination, late/stale read handling and exact in-tab recovery SHALL remain effective.

#### Scenario: FLOW-UX-003-A Inspect period evidence at each viewport
- **GIVEN** the actual initialized application with a saved contribution
- **WHEN** the owner inspects period totals, toggles its identity and uses the narrow table's scroll region
- **THEN** full exact identity and economic values remain reachable, and light/dark360/768/1440layouts fit without page overflow
- **AND** changing presentation or selecting panels leaves financial rows and provider counters unchanged

#### Scenario: FLOW-UX-003-B Preserve stale-read and lost-delivery protections
- **WHEN** a real pinned continuation becomes stale or a completed response arrives after period edits
- **THEN** stale/mixed results are not presented and an unsaved correction remains unchanged
- **WHEN** a committed flow response is lost, then a real401/MFA recovery and failed current read occur
- **THEN** explicit identical retry returns the original receipt without duplicate flow, and writes remain blocked until successful journal refresh
