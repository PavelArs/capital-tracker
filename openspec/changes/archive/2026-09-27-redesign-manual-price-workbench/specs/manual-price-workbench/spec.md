## ADDED Requirements

### Requirement: PRICE-UX-001 Focused manual entry preserves exact scope
The page SHALL keep manual, unreconciled, isolated USD/unit price scope visible and provide full correction/void/identity rules through a native keyboard disclosure. Instrument identity, explicit time zone/UTC and nonnegative exact unit price including explicit zero SHALL have associated field guidance. The editor SHALL precede saved-price/history evidence after selection and recovery notices. Existing exact input values, command review, write locks, receipts and explicit retry SHALL remain unchanged.

#### Scenario: PRICE-UX-001-A Select and record a reviewed manual point
- **GIVEN** a real HTTPS/password/MFA session with PostgreSQL and two instruments sharing a symbol
- **WHEN** the owner inspects rules and associated field guidance and selects an instrument by UUID
- **THEN** manual/unreconciled/isolated-point scope stays visible and native keyboard disclosure changes no financial data or requests
- **WHEN** the existing explicit save/correct/retry workflow is used
- **THEN** exact saved prices100/110, immutable receipt identity and the original review/accepted-refresh locks remain effective without provider calls

### Requirement: PRICE-UX-002 Row actions guide review without late focus changes
Selecting void or history from a saved row, or history for the entered date, SHALL focus its rendered editor/history heading immediately. Cancel void and close history SHALL return focus to the corresponding connected enabled initiating control, otherwise the page heading. Close SHALL invalidate pending history reads. Read completion SHALL NOT move focus or alter independent entry values; staging/cancel/close SHALL NOT send a price command.

#### Scenario: PRICE-UX-002-A Stage and cancel exclusion
- **GIVEN** a saved exact price
- **WHEN** the owner selects its exclusion action
- **THEN** the exclusion heading receives focus and confirmation remains disabled until explicit review
- **WHEN** exclusion is cancelled
- **THEN** the original draft remains, review resets and focus returns to that row action with no financial write
- **WHEN** the owner stages again, reviews and confirms
- **THEN** the price is removed from the effective book and its immutable versions remain discoverable

#### Scenario: PRICE-UX-002-B Inspect and close delayed real history
- **GIVEN** a real history read whose delivery is delayed and an unsaved price draft
- **WHEN** history is selected and the owner moves focus to another control
- **THEN** history received focus immediately, the later response does not steal focus and the draft remains unchanged
- **WHEN** history is closed before a pending response arrives
- **THEN** focus returns to its initiating live enabled control and the late response cannot reopen the panel

### Requirement: PRICE-UX-003 Responsive exact evidence and recovery
At360,768and1440pixels in light/dark themes, the page SHALL have no horizontal page overflow and main controls SHALL have at least44px height with visible focus/readable text. Saved prices SHALL remain a semantic table with caption, exact UTC/USD/source evidence and a named keyboard-focusable contained scroll region. Immutable history and visible recovery/error/receipt information SHALL remain reachable and distinguish zero, absent and voided data.

#### Scenario: PRICE-UX-003-A Inspect current and historical prices
- **GIVEN** the actual saved/corrected point and its history
- **WHEN** the owner views both themes and all three widths and scrolls the narrow price table by keyboard
- **THEN** exact prices, UTC moments, manual source, revision/history and actions remain readable/reachable without page overflow
- **AND** presentation actions preserve financial fingerprints and provider counts

#### Scenario: PRICE-UX-003-B Preserve uncertain delivery and selection invalidation
- **WHEN** the real save response is lost after commit and the owner explicitly retries
- **THEN** the unchanged original command returns its original receipt with no duplicate
- **WHEN** an accepted correction is followed by a failed refresh or an old book response arrives after another instrument is selected
- **THEN** new writes stay blocked until the required successful refresh, and old evidence cannot populate the new selection
