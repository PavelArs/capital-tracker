# account-analytics Specification

## Purpose
Provide focused, responsive account-analysis tasks while preserving exact financial
evidence, mounted intent and authenticated explicit-read boundaries.
## Requirements
### Requirement: ANALYTICS-001 Focused task selection retains intent
Authenticated account analytics SHALL show one selected task: valuation at a date
initially, sampled value history, or accounting positions. A labeled native selector
SHALL expose selection and its controlled panel. All original owners SHALL stay
mounted while hidden controls leave the focus order. Switching task or outer account
section SHALL preserve inputs, loaded exact results and independent trade drafts
without implicit reads/writes/provider calls or changed recovery identity. A different
account SHALL use its own original identity lifecycle and default task.

#### Scenario: ANALYTICS-001-A Choose a task without recalculating
- **GIVEN** actual password/MFA authentication, a manual account and an explicitly calculated result
- **WHEN** the owner switches among valuation, history and accounting using the keyboard
- **THEN** only the selected task is visible, the selector retains focus and every original owner stays mounted
- **AND** returning preserves exact inputs/results and the separate trade draft without extra requests or financial/provider changes
- **WHEN** the owner leaves and returns to the outer analytics section
- **THEN** the selected task and its intent remain

### Requirement: ANALYTICS-002 Guided responsive exact evidence
The three read tools SHALL associate concise UTC/price/sampling explanations with
inputs and provide keyboard-operable method disclosures. Essential scope, incomplete
status and unknown-versus-zero distinctions SHALL remain visible. Exact results SHALL
precede secondary provenance while every original coverage/origin/revision and price
field remains available. Tables SHALL have named keyboard-scroll regions; controls
and full exact values SHALL remain readable at360/768/1440 in both themes without
page overflow, with44px primary inputs/actions and visible focus.

#### Scenario: ANALYTICS-002-A Inspect exact results and methodology
- **GIVEN** actual complete/incomplete valuation, accounting positions or sampled history
- **WHEN** the owner reads result totals/tables and opens or closes methodology
- **THEN** exact decimal values and provenance remain unchanged, partial value is not presented as a complete total, and unknown is distinct from zero
- **AND** disclosure/theme/viewport changes issue no requests or financial commands and preserve the selected task/draft/results
- **WHEN** a wide result table is focused on a narrow screen
- **THEN** keyboard scrolling exposes its full exact values inside the page boundary

### Requirement: ANALYTICS-003 Preserve explicit read and history boundaries
Presentation SHALL retain original authenticated reads, stale-account/revision/date
response rejection, pinned pagination, no-store/private boundaries and financial
effects. Accounting cost SHALL remain distinct from market value; incomplete price
coverage SHALL keep total unavailable with a separate priced subtotal. History SHALL
retain30elapsed-day/31point bounds, complete-only points including zero, no connecting
lines/interpolation, and exact table/tooltips with approximate chart coordinates.

#### Scenario: ANALYTICS-003-A Retain late-response and pinned-result correctness
- **WHEN** a real delayed read arrives after its input changed, or a history continuation encounters a changed journal revision
- **THEN** it cannot replace edited intent or display stale results, and the independent unsaved trade correction remains intact
- **WHEN** the owner explicitly refreshes after a stored price becomes known zero
- **THEN** valuation/history preserve their established exact complete-zero result and actual request/financial/provider invariants

