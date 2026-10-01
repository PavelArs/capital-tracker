## Why

The retained currency-visibility screen silently presents failed reads as empty lists,
uses ambiguous row actions and truncates identity evidence. Completing the Settings
redesign requires an honest, usable view of these existing preferences.

## What Changes

- Give visible/hidden lists announced selection, clear counts and explicit load state.
- Keep the last successful pair of lists on a later failure, show an inline recovery
  action, and serialize visibility commands without changing backend contracts.
- Render full stored currency identity/contract and status in focused, responsive
  tables; clearly distinguish catalogue visibility from accounting or network support.
- Remove obsolete styles and unused presentation paths only after caller inventory.
- Add one real browser preference/recovery journey and retain the existing FX journey.

## Capabilities

### New Capabilities

- `currency-visibility`: usable, recoverable presentation of the existing owner-scoped
  legacy currency-visibility preferences with preserved financial/provider boundaries.

### Modified Capabilities

None. Existing settings-workbench navigation, conditional mounting and FX remain.

## Impact

Depends on archived settings-workbench and owner authentication. Main product scope:
CurrencyManager and scoped CSS; no accounting/backend/schema/auth/provider/dependency
or deployment changes. No data removal; only explicit existing hide/show commands alter
owner preferences. Preserve owner Nginx, other work and durable preview. This does not
complete integration health, network adapters, whole frontend redesign or owner review.
