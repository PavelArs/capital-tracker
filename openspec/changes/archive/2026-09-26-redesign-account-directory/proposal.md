## Why

The working entry still puts an empty creation form before saved accounts and a long
valuation form below them. The owner's required redesign should make finding an
account the default task, with creation and valuation available on demand.

## What Changes

- Lead the manual-account page with its saved-account directory and an honest loaded
  count; retain pagination, loading/error/empty states and existing account links.
- Offer a labelled “Новый счет” action that reveals an inline creation form. Closing
  and reopening preserves the entered name and original request ID after ambiguous
  delivery; only explicit submission writes. Preserve the success link even if the
  created account is outside the currently loaded page.
- Put selected-account valuation in a native disclosure that preserves selection,
  time and result while collapsed. Keep its exact economics and scope caveats.
- Apply compact, responsive page-specific styles; fix the valuation checkboxes that
  currently inherit full-width text-input sizing.

## Capabilities

### New Capabilities
- `account-directory`: focused account entry, reversible form disclosure and accessible
  responsive directory presentation.

### Modified Capabilities
- `manual-portfolio-valuation`: clarify that collapsing the supplementary panel keeps
  the current valuation intent; leaving the page still invalidates pending results.

## Impact

Frontend ManualAccounts and scoped CSS, the existing valuation component's CSS,
focused acceptance and retained creation/valuation journeys. Depends on the implemented
`redesign-application-shell`, whose independent review remains pending. No backend,
API, schema, provider, dependency or deployment change; no owner-data cleanup.

Non-goals: account-detail/editor tabs, new metrics/search, whole-portfolio valuation,
chart periods, new component library, full FUI completion or owner visual approval.
