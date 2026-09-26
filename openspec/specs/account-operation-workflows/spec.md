# account-operation-workflows Specification

## Purpose
Expose one account operation workflow at a time while retaining independent mounted drafts, shared results and financial guards.
## Requirements
### Requirement: WORKFLOW-001 Focused operation selection
An initialized manual account SHALL offer a labelled native selector for Сделки в USD, Обмены активов, Вознаграждения and Импорт CSV. Trades SHALL be selected initially. Only the selected workflow SHALL be visible; hidden workflows SHALL remain mounted and outside keyboard focus order. Shared journal results and journal recovery SHALL remain available. The selector SHALL work by keyboard and at360/768/1440px without page-level horizontal overflow.

#### Scenario: WORKFLOW-001-A Choose one task
- **GIVEN** actual password/MFA authentication and an initialized account
- **WHEN** the owner opens operations
- **THEN** trades and journal results are visible, while swap, reward and CSV inputs are hidden
- **WHEN** the owner selects another workflow by keyboard
- **THEN** only its editor is visible and the selector retains focus and exposes the selection

### Requirement: WORKFLOW-002 Preserve independent intent and recovery
Workflow selection, viewport changes and account-section selection SHALL preserve mounted drafts, selected CSV File, validation/review and original retry identity without submitting a command or changing financial guards. A hidden unresolved CSV command SHALL continue to block incompatible trade writes. Existing real authentication and account isolation SHALL remain in force.

#### Scenario: WORKFLOW-002-A Retain four independent drafts
- **GIVEN** a trade amount, swap quantity, reward quantity and unuploaded CSV file
- **WHEN** the owner changes workflows, account sections and viewport width
- **THEN** the same editor nodes and exact inputs/File remain, without implicit accounting commands or reloads

#### Scenario: WORKFLOW-002-B Recover the original committed command
- **GIVEN** a swap, reward or CSV command committed by the real backend with its response lost in transit
- **WHEN** the owner switches away and returns, including a permitted SPA return
- **THEN** the original command and frozen target remain explicitly recoverable and existing cross-editor locks remain
- **WHEN** the owner explicitly retries
- **THEN** the actual backend replays the same identity with no duplicate financial effect

### Requirement: WORKFLOW-003 Reveal an explicitly selected trade
Correcting or voiding a trade from shared results SHALL select the trade workflow and expose the existing editor/confirmation. The action SHALL retain existing target/revision locks and SHALL NOT submit a command before explicit confirmation.

#### Scenario: WORKFLOW-003-A Correct a trade from another workflow
- **GIVEN** another workflow is selected and a persisted trade is visible in shared results
- **WHEN** the owner selects its correction action
- **THEN** the trade editor becomes visible with that exact target and values, while the other workflow draft remains mounted
- **AND** no financial write occurs until explicit submission

#### Scenario: WORKFLOW-003-B Review a void from another workflow
- **GIVEN** another workflow is selected and a persisted trade is visible in shared results
- **WHEN** the owner selects its void action
- **THEN** the trade workflow shows the exact target identity/version and explicit confirmation
- **WHEN** the owner cancels
- **THEN** the other workflow draft remains and no financial write has occurred
