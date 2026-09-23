## Why

The current crypto/FX caches cannot supply durable historical prices. The owner
needs stored, explicitly manual dated USD prices while provider identity and
archival permissions are resolved separately. This gives historical valuation a
database-backed input without turning missing provider observations into zero.

## What Changes

- Store exact reviewed USD unit prices for existing owner-scoped manual instruments.
- Preserve corrections as immutable versions with idempotent commands and revision checks.
- Provide database-only current-point/history reads and a protected Russian editing screen.

## Capabilities

### New Capabilities
- `manual-usd-prices`: Dated manual price versions, coherent pages, command safety and private UI.

### Modified Capabilities
None. Existing manual instruments, accounting, profit and XIRR retain their contracts.

## Impact

Additive migration18, entity, small accounting service/controller/input boundary,
typed frontend screen and focused tests. Reuse existing manual instrument UUIDs,
auth, exact decimal parsing, transactions and deployment pipeline. No new dependency.

Non-goals: automated provider ingestion or identity mapping, historical interpolation,
portfolio valuation/TWR, automatic profit inputs, market-price certification,
legacy cache removal, production deployment or consolidation/deletion. Existing
user data is retained; down migration refuses destructive automatic rollback.
