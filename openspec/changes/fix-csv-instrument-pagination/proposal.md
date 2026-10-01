## Why

CSV mapping already displays the account page's first instrument page, but its independent cursor starts empty. The first “load more” request repeats that page and adds no choices, blocking the retained progress assertion when an exact target UUID is beyond the first 50 instruments.

## What Changes

- Keep the account page as the sole owner of instrument choices, pagination, loading and errors; delegate the CSV load action to that owner.
- Make the first CSV load-more action use the authoritative next cursor and hide it when the catalog is exhausted.
- Preserve file, explicit mapping, preview, receipt and original-command recovery during catalog loading and retry.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `csv-workbench`: explicit instrument pagination progress and state preservation under loading/error/retry.

## Impact

Frontend only: ManualAccountDetail, TradeJournal, CsvImports and CsvMapping plus focused component acceptance. No data migration, backend/API/authentication/quota/provider change or dependency change. Depends on the existing owner-scoped exclusive UUID catalog API and retained CSV acceptance. The existing E2E progress and exact financial/recovery oracles remain unchanged. Deployment, catalog redesign and unrelated CSV behavior are non-goals.
