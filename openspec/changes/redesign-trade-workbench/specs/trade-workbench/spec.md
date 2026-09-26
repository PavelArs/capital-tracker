## ADDED Requirements

### Requirement: WORKBENCH-001 Grouped precise trade entry
Trade entry SHALL group instrument/direction, amounts and execution time, retaining
existing Russian labels, exact string inputs and submit/disabled behavior. Gross USD,
fee, UTC and timestamp-order guidance SHALL be associated with the corresponding
control through its accessible description. Layout SHALL fit360/768/1440px in the
existing light/dark themes without page-level horizontal overflow or truncated amounts.

#### Scenario: WORKBENCH-001-A Enter an exact operation
- **GIVEN** an authenticated owner with an initialized journal
- **WHEN** the owner enters a trade and reads its field guidance
- **THEN** quantity and USD strings are preserved exactly, gross means total rather than unit price, fee is separate, time is UTC and order distinguishes equal instants
- **AND** the same trade draft and editor nodes survive context/workflow changes

### Requirement: WORKBENCH-002 Deliberate history action focus
An accepted explicit correction/void selection SHALL reveal trades, focus a named
editor workbench and scroll its start into view without submitting. Cancellation SHALL
return focus to the originating history action if connected and enabled, otherwise to
the workbench. Ordinary input, refresh, disclosure, resize and workflow selection SHALL
NOT schedule this focus. Existing unresolved-command and mutation guards SHALL remain.

#### Scenario: WORKBENCH-002-A Correct or void from history
- **GIVEN** a persisted trade and a different selected workflow
- **WHEN** the owner activates its correction action with the keyboard
- **THEN** the correction workbench is focused and in the viewport with that trade's exact draft and identity
- **WHEN** the owner cancels
- **THEN** focus returns to the same history correction action without a write
- **WHEN** the owner activates void and cancels it
- **THEN** the named confirmation workbench receives focus, retains explicit confirmation, and returns focus to the originating void action without a write

#### Scenario: WORKBENCH-002-B Keep focus and recovery under ordinary updates
- **GIVEN** an exact draft or an unresolved committed trade response
- **WHEN** the owner edits fields, changes workflow/context or retries the original request
- **THEN** ordinary updates do not run history-action focus, frozen/retry guards remain and retry replays the original receipt without a duplicate effect

### Requirement: WORKBENCH-003 Readable exact shared results
Shared journal results SHALL retain complete semantic captions/columns, exact amounts,
copyable identities, original provenance, unknown-cost distinctions and paging/actions.
Result action controls SHALL use theme-safe styling, visible focus and44px minimum
targets. Wide tables SHALL scroll within their own container rather than the page.

#### Scenario: WORKBENCH-003-A Inspect current evidence
- **GIVEN** persisted journal results and existing unknown/zero-cost characterization
- **WHEN** the owner inspects results at mobile/tablet/desktop widths
- **THEN** totals and original table evidence remain exact and readable, table overflow stays contained and action controls remain usable
- **AND** layout changes trigger no implicit accounting/provider activity
