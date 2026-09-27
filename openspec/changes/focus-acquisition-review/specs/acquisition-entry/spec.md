## ADDED Requirements

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
