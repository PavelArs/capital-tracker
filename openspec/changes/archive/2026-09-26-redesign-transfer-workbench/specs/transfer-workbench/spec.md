## ADDED Requirements

### Requirement: TRANSFER-UX-001 Guided internal transfer entry retains exact meaning
The Russian editor SHALL group accounts and principal, UTC time and ordering, and fee fields with programmatically associated guidance. It SHALL explain that recipient quantity excludes the sender's fee, a zero fee has no fee asset, and consumed fee basis is historical cost rather than market value. The explicit internal-movement attestation, review action, fixed correction account pair and all existing review/write locks SHALL remain effective. No funds are sent and no external USD flow is created.

#### Scenario: TRANSFER-UX-001-A Fill and review exact amounts
- **GIVEN** a real password/MFA owner session and two initialized PostgreSQL accounts
- **WHEN** the owner fills principal 1.5 and fee 0.1 in the grouped editor
- **THEN** quantity, UTC/order and fee guidance are available as accessible descriptions without changing field labels or values
- **AND** submission stays disabled until successful account review and explicit internal ownership confirmation
- **WHEN** a reviewed economic field changes
- **THEN** submission requires review again; changing only the confirmation does not invalidate the reviewed economics

### Requirement: TRANSFER-UX-002 History actions locate the selected editor
Selecting an allowed correction or void SHALL focus the visible editor heading without waiting for an asynchronous review. Explicit cancellation SHALL return focus to the initiating history action when it remains connected and enabled, otherwise to the editor heading. Review completion SHALL NOT steal focus after the owner moves to another control. Selecting or cancelling alone SHALL NOT write an operation.

#### Scenario: TRANSFER-UX-002-A Correct and cancel from history
- **GIVEN** a saved transfer with an enabled correction action
- **WHEN** the owner selects correction from its history card
- **THEN** the correction heading receives focus and the selected values remain editable with the account pair locked
- **WHEN** the owner cancels
- **THEN** focus returns to that card's correction action and no version is written

#### Scenario: TRANSFER-UX-002-B Review a terminal void
- **GIVEN** a saved active transfer
- **WHEN** the owner selects its void action
- **THEN** the void editor heading receives focus, fields remain disabled and the original version/account review is required before confirmation
- **AND** cancellation returns to its void action without sending a command

### Requirement: TRANSFER-UX-003 Compact history preserves evidence and recovery
History cards SHALL lead with quantity/asset or explicit terminal-void state and the account direction. Full transfer identity SHALL remain copyable in a native keyboard-accessible disclosure; versions and current allocation remain reachable separately from immutable receipts. At 360, 768 and 1440 pixels the page SHALL have no horizontal overflow, with wide financial tables allowed contained scrolling. Main controls SHALL have at least 44px height, visible focus and readable light/dark text. No client amount conversion, provider request, automatic retry or backend/authentication substitution is introduced.

#### Scenario: TRANSFER-UX-003-A Read and inspect saved evidence
- **GIVEN** a saved transfer and the real authenticated application
- **WHEN** the owner inspects its card at mobile, tablet and desktop widths in both themes
- **THEN** quantity/asset and account direction are visible, identity disclosure works by keyboard, controls fit and exact allocation evidence remains available
- **AND** switching presentation does not alter business rows or call providers

#### Scenario: TRANSFER-UX-003-B Lost committed response and immutable retry
- **GIVEN** the real backend committed the displayed principal and fee but delivery is lost
- **WHEN** the owner explicitly retries the saved command
- **THEN** identical request and payload return the original receipt without a second movement
- **AND** correction and terminal void preserve the existing exact holdings, fee basis and no-provider assertions
