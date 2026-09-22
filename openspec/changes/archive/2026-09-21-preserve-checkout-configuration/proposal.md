## Why

The artifact check requires the owner's uncommitted Nginx checksum. A clean checkout
has different legitimate bytes and therefore fails CI. Preservation must compare
the actual checkout before and after acceptance, without weakening image checks.

## What Changes

- Capture the existing regular Nginx file before acceptance side effects and check
  unchanged contents/type/permissions after execution and cleanup, including failures.
- Remove the machine-specific checksum from artifact inspection; retain all image,
  network, provider, authentication and PostgreSQL checks.
- Keep the exact owner-file checksum in local preservation evidence.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `isolated-release-acceptance`: make configuration preservation portable and fail closed.

## Impact

Only the acceptance harness and engineering tests change; no application, schema,
dependencies, owner configuration or production pipeline changes. Depends on the
verified release harness and session slice. No repository consolidation or deletion.
