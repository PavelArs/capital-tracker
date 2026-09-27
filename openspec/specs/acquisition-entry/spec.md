# acquisition-entry Specification

## Purpose
Provide guided, responsive swap and reward entry while preserving exact financial
evidence, explicit review and original-command recovery.
## Requirements
### Requirement: ENTRY-001 Guided exact acquisition fields
Swap and reward entry SHALL group related fields and expose concise Russian descriptions
on the relevant controls. Swap guidance SHALL distinguish gross incoming quantity,
unknown versus known-zero USD valuation, held versus incoming-asset fee source, and
explicit time zone/order. Reward guidance SHALL distinguish independent basis/income,
unknown versus known-zero values, unclassified category and explicit time zone/order.
Existing labels, options, exact strings and conditional fields SHALL remain intact.

#### Scenario: ENTRY-001-A Read swap evidence guidance
- **GIVEN** an owner in the swap editor
- **WHEN** the owner reads quantity, valuation, fee-source and time controls
- **THEN** their accessible descriptions explain the corresponding distinctions and agree with the original review/receipt values
- **AND** changing known/unknown or fee source preserves the established explicit clearing/linking behavior

#### Scenario: ENTRY-001-B Read independent reward evidence
- **GIVEN** an owner in the reward editor
- **WHEN** the owner reads basis, income, category and time controls
- **THEN** accessible descriptions distinguish unknown from explicit zero, identify unclassified review and retain independent exact evidence

### Requirement: ENTRY-002 Retained explicit review and recovery
Grouping and styling SHALL retain review invalidation, required assertions, busy/void
locks and unchanged submit/cancel behavior. Recovery SHALL remain outside the disabled
fieldset, with original immutable request and receipt evidence. Drafts SHALL remain
mounted across ordinary workflow/section/theme/viewport changes without implicit writes.

#### Scenario: ENTRY-002-A Preserve financial intent and committed retry
- **GIVEN** a reviewed swap or reward with a precise draft
- **WHEN** the owner changes a reviewed input
- **THEN** its review becomes invalid and saving remains blocked until an explicit new review
- **GIVEN** an actual committed command whose response was lost
- **WHEN** the owner returns through the SPA and explicitly retries
- **THEN** the original command/receipt is replayed without duplicate effects and unrelated trade drafts remain intact

### Requirement: ENTRY-003 Consistent responsive operation forms
Trade, swap and reward forms SHALL share scoped responsive presentation. Group headings,
hints, conditional inputs and review/submit/cancel actions SHALL be readable in both
themes at360/768/1440px without page horizontal overflow. Text/select/action targets
SHALL be at least44px high; confirmation checkboxes SHALL retain their native compact
shape and complete associated labels. Exact values SHALL NOT be rounded or truncated.

#### Scenario: ENTRY-003-A Inspect all field groups and actions
- **GIVEN** populated conditional evidence and fee fields
- **WHEN** the owner uses a mobile, tablet or desktop viewport in either theme
- **THEN** every field group and action fits, descriptions remain associated and exact values/drafts persist
- **AND** the existing trade workflow/context/focus/CSV File characterization remains passing

### Requirement: ENTRY-004 Explicit acquisition review navigation
Swap and reward row correction/void actions SHALL move keyboard focus to the corresponding named editor region after rendering. Cancellation SHALL preserve the original blank-create reset and return focus to the initiating connected enabled row action, otherwise a stable section heading. Staging/cancelling SHALL NOT submit commands or alter independent operation drafts, financial data or provider counts. Existing exact review/receipt/recovery guards SHALL remain intact; asynchronous completions SHALL NOT request focus.

#### Scenario: ENTRY-004-A Stage and cancel correction or void
- **GIVEN** an authenticated owner with a saved swap or reward and an independent trade draft
- **WHEN** correction or void is selected from its saved row
- **THEN** the correctly named editor receives focus and original required review still gates submission
- **WHEN** the owner cancels
- **THEN** its original blank create state is restored, focus returns to the live enabled initiating action and the independent trade draft remains unchanged
- **AND** these navigation actions cause no command, financial mutation or provider request

#### Scenario: ENTRY-004-B Preserve the existing exact command journey
- **WHEN** the owner reviews, retries an actually committed response-loss command, corrects known-zero evidence and voids a swap or reward
- **THEN** the original immutable receipt/payload, exact financial fields, stale-review invalidation and final journal outcomes remain unchanged

### Requirement: ENTRY-005 History focus and close reject late delivery
Opening swap or reward history SHALL immediately focus its rendered history heading. Read completion SHALL NOT move focus, alter the independent editor draft or replace its opener. Closing history SHALL invalidate the pending generation and, after rendering, return focus to its connected enabled initiating button, otherwise the stable section heading. Pagination SHALL preserve the original opener. Focus outlines and named review contexts SHALL remain visible in the existing responsive forms.

#### Scenario: ENTRY-005-A Read real delayed versions without stealing focus
- **GIVEN** an unsaved draft and a genuine history response whose delivery is delayed
- **WHEN** history is opened and the owner moves focus to a different control
- **THEN** history received focus immediately and later delivery preserves the new focus, exact draft and immutable versions

#### Scenario: ENTRY-005-B Close while history is pending
- **WHEN** history is closed before its genuine response arrives
- **THEN** the opener is re-enabled and focused after the close render, the late response cannot reopen history, and no command or financial/provider effect occurs
- **AND** the new focus contexts are readable in actual mobile-dark and desktop-light views without page overflow
