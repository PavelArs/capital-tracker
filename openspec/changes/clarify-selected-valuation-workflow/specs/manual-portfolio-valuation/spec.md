## ADDED Requirements

### Requirement: MPV-UI-1 Explain selected-manual valuation scope
The valuation view SHALL state near its result that it covers only selected manual accounts, excludes cash and connected wallets, and does not reconcile overlapping real holdings. Detailed method explanation SHALL be available in a native disclosure labeled `Что входит в оценку`. Opening or closing it SHALL preserve the current selection, UTC instant and result and SHALL issue no additional API request. Exact and unknown values SHALL retain their existing labels and strings.

#### Scenario: VAL-UI-METHOD Disclosure preserves the result without a request
- **GIVEN** a valuation result is visible for selected manual accounts
- **WHEN** the owner opens or closes `Что входит в оценку`
- **THEN** the selected accounts, UTC instant, result and displayed exact/unknown values remain unchanged
- **AND** no additional valuation request is made.

### Requirement: MPV-UI-2 Make wide valuation evidence keyboard-scrollable
Each result table SHALL retain its existing accessible table name and row semantics inside a separately named, keyboard-focusable region with contained horizontal scrolling and a visible keyboard focus indicator. A short cue SHALL explain horizontal scrolling on narrow screens. Instrument names and exact number strings SHALL remain available without truncation.

#### Scenario: VAL-UI-REGIONS Navigate both valuation tables
- **GIVEN** a selected-account result contains account and instrument tables
- **WHEN** the owner navigates by keyboard to either table region
- **THEN** each region has a distinct accessible name and visible focus, and the original table names and instrument row headers remain available
- **AND** the instrument allocation table precedes account evidence and horizontal scrolling stays within the focused region.
