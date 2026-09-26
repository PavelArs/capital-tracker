## Why

The account workspace separates analysis and setup, but its operations section still displays four complete workflows together. A focused choice reduces scrolling and competing actions while retaining established financial safeguards.

## What Changes

- Add a native Russian workflow selector: Сделки в USD, Обмены активов, Вознаграждения, Импорт CSV; trades remain the default.
- Show one workflow at a time while keeping all editors mounted and the shared journal results/recovery available.
- Selecting an existing trade for correction or void reveals its editor without submitting it.
- Preserve independent drafts, CSV file/review state, explicit retries and existing cross-editor guards.

## Capabilities

### New Capabilities
- `account-operation-workflows`: focused, persistent account operation selection.

### Modified Capabilities
None. Financial/authentication/API contracts remain unchanged; tests gain explicit UI entry actions.

## Impact

TradeJournal presentation, one small native-control component/CSS and scoped unit/browser tests. No backend, schema, dependencies, data, authentication or deployment changes. Depends on account-workspace implementation3ad13f7; its independent review remains pending.

Non-goals: unified cross-account operation history, changing editor semantics, provider/import expansion, responsive redesign of every field, production/preview deployment or final consolidation. Keep owner Nginx and all user/preview data. Review remains required before archive.
