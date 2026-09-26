## ADDED Requirements

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
