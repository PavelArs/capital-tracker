## Why

The audited target removes the legacy household-liability UI as portfolio workflows
replace it. The old editor and its dedicated chart/forms still add unrelated code
and navigation beside the verified manual-account workflows.

## What Changes

- **BREAKING** Remove the legacy liability editor/list/chart from the frontend and
  its navigation entry, frontend-only API wrapper, types and obsolete wrapper tests.
- Keep authenticated old bookmarks on a small Russian retirement notice linking to
  manual accounts, without loading legacy financial data or calling providers.
- Preserve every backend liability endpoint, authorization guard, table and row;
  retain shared dashboard category translations and all existing historical charts.
- Verify real HTTPS/MFA/PostgreSQL preservation and the retained portfolio workflow.

## Capabilities

### New Capabilities
- `legacy-liabilities-retirement`: Retire the unrelated editor without deleting saved data.

### Modified Capabilities
None. Backend private-route/session behavior and all accounting/chart requirements
stay unchanged. The removed editor has no existing canonical capability contract.

## Impact

Frontend App/Layout route wiring, dedicated liability feature files, API barrel,
liability-only types/translations and six obsolete frontend-wrapper tests. No
database migration, dependency change, backend edit or production deployment.

Keep current GHCR/Compose pipeline and protected rollout switch. Source history
retains the retired editor; original repositories, owner Nginx edit and owner data
remain untouched. Broader legacy dashboard/assets/API retirement, data export or
deletion, current pricing and chart maximum-period review are separate work.
