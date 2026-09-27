# period-review-workbench Specification

## Purpose
Provide a focused Russian period-review workflow with distinct exact metrics, accessible
method/evidence disclosures and a mounted optional linked-TWR editor that preserves intent.
## Requirements
### Requirement: PERIOD-UX-001 Focused inputs retain honest metric scope
The page SHALL keep manual valuation, unreconciled flows, temporary results and absence of current cash-balance calculation visible. Full profit/XIRR/TWR method explanations SHALL be available in an initially collapsed native keyboard disclosure. Existing reviewed inputs, validation, action names and independent calculation semantics SHALL remain. Profit, annualized XIRR and period-only TWR SHALL retain distinct labels and unavailable reasons without a fabricated numeric value.

#### Scenario: PERIOD-UX-001-A Review methods and calculate exact profit
- **GIVEN** a real HTTPS password/MFA session and PostgreSQL flow journal
- **WHEN** the owner opens the period page and toggles the method disclosure by keyboard
- **THEN** scope remains visible, full methods are reachable, and toggling does not edit inputs or submit a request
- **WHEN** the owner reviews the existing period and valuations and calculates
- **THEN** exact profit, including zero or loss, leads its result while original period, valuations, flow totals, revision and coverage remain readable or available through a native evidence disclosure

#### Scenario: PERIOD-UX-001-B Distinguish available and unavailable returns
- **WHEN** the owner calculates XIRR or endpoint TWR from reviewed inputs
- **THEN** the existing exact profit remains available, XIRR is explicitly annualized and TWR is period-only
- **AND** unsupported cases show the existing reason without a numeric rate placeholder or implied forecast
- **WHEN** an input changes or a newer request supersedes an old one
- **THEN** review and old results clear and delayed replies cannot restore them

### Requirement: PERIOD-UX-002 Optional linked review preserves mounted intent
The linked-TWR editor SHALL be reachable through an initially collapsed native disclosure. Opening or closing it SHALL NOT request data, clear boundary values/review/results or unmount its controller. Editing period or valuation inputs SHALL retain the existing distinct invalidation semantics. Required review, revision pinning, explicit requests and stale-plan refusal SHALL remain effective even while the disclosure is closed.

#### Scenario: PERIOD-UX-002-A Open and retain a reviewed boundary calculation
- **GIVEN** a real journal with an intermediate external flow
- **WHEN** the owner opens linked TWR, loads real boundaries, fills and reviews the intermediate valuation
- **AND** closes and reopens the disclosure
- **THEN** the exact entered value, review and current plan persist without another request
- **WHEN** the owner explicitly calculates
- **THEN** the exact linked return and profit remain correct and toggling the disclosure preserves the result

#### Scenario: PERIOD-UX-002-B Preserve invalidation while folded
- **GIVEN** a reviewed linked plan and a delayed real boundary or preview response
- **WHEN** period or valuation inputs change, including with the linked disclosure closed
- **THEN** the original invalidation rules clear review/results or the period-specific plan as appropriate, and delayed replies cannot restore stale evidence
- **AND** a changed journal revision still refuses the stale calculation and requires a new plan

### Requirement: PERIOD-UX-003 Responsive results retain exact evidence
At360,768and1440pixels in both themes, the page SHALL have no horizontal page overflow, readable exact values and at least44px main controls with visible keyboard focus. Linked boundary evidence SHALL use a named focusable contained table scroll area. Presentation changes SHALL preserve all financial rows, admission/provider counts and privacy contracts.

#### Scenario: PERIOD-UX-003-A Inspect real profit and linked evidence
- **GIVEN** an actual profit result and an actual linked-TWR result with boundary evidence
- **WHEN** the owner inspects both themes and all three viewport widths, opens available evidence and scrolls the narrow boundary table by keyboard
- **THEN** original values, missing-value markers and scope are reachable without page overflow
- **AND** controls remain usable and no presentation-only action mutates financial data or calls a provider
