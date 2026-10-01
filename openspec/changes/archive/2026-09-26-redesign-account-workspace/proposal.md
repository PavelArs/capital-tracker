## Why

Individual accounts mix operation editors, historical analysis and initial-data maintenance on one long page. The saved opening snapshot is misleadingly labelled as current positions. This slice implements the next bounded part of the requested frontend redesign.

## What Changes

- Provide three explicit account sections: Операции, Аналитика, Начальные данные; show operations initially.
- Keep all section contents mounted across switching and resizing, preserving drafts, results, eligibility guards and frozen retries.
- Label the opening snapshot as saved initial positions with its actual revision/coverage, separate from effective journal lots.
- Keep native keyboard controls, scoped responsive styles and exact financial evidence.

## Capabilities

### New Capabilities
- `account-workspace`: focused account navigation with persistent section state and honest opening-snapshot scope.

### Modified Capabilities
None. Existing financial, authentication and historical-result contracts remain unchanged; only their presentation locations change.

## Impact

Frontend ManualAccountDetail/TradeJournal presentation, one small account workspace component, CSS and affected E2E entry selectors. No backend, API, authentication, schema, lockfile or deployment changes; no data migration or deletion.

Depends on the integrated shell/directory implementations (5099690); their independent reviews remain pending. Non-goals: complete operation-form redesign, shared analytical dates, chart maximum period, global portfolio, providers, production/preview deployment, consolidation or archive before independent review.
