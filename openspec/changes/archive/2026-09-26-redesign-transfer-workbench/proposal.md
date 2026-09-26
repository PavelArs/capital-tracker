## Why

The owner requested a complete restrained, responsive frontend redesign. Internal transfers still use a flat form and UUID-led history; selecting a correction or void leaves keyboard focus far from the editor.

## What Changes

- Group transfer fields into accounts/principal, time/order and fee sections, with associated guidance and a visible account-review step.
- Move focus to the editor when selecting a correction or void; cancellation returns to the initiating history action when available.
- Lead history cards with exact quantity/asset and account direction, retaining identity in a native disclosure and keeping allocations, versions, receipt and recovery reachable.
- Reuse the installed React and shared operation form CSS; scoped responsive controls and readable light/dark themes.

## Capabilities

### New Capabilities
- `transfer-workbench`: accessible transfer entry, history-to-editor navigation and responsive presentation.

### Modified Capabilities
None. Existing owned-account-transfers economics, concurrency and retry requirements remain unchanged.

## Impact

OwnedTransferForm, OwnedTransfers, scoped CSS and the existing TRANSFER-UI browser journey. Depends on the archived shared operation forms and existing transfer controller. No backend/API, migration, dependency, provider or deployment change. No data impact. External USD flow screens, other editors, broad analytical redesign and production/consolidation remain separate changes. Preserve owner Nginx edits, preview data and original repositories.
