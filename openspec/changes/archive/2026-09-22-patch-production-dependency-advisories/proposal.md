## Why

The production dependency audit of the verified MFA checkpoint reports 25 high,
38 moderate and 3 low advisories. Known high/critical dependency findings must block
promotion, and a repeatable CI check must prevent unnoticed regressions.

## What Changes

- Update affected direct/transitive production dependencies to reviewed compatible
  versions and record exact resolutions in the pnpm lockfile.
- Add a reusable production audit command and required fail-closed CI gate for
  high/critical advisories and audit infrastructure failures.
- Record dated findings, remediation and any remaining lower-severity scope honestly.
- Preserve existing passing authentication, migration and wallet characterization.

## Capabilities

### New Capabilities

- `dependency-security`: production audit scope, severity gate, reproducible fixes
  and evidence with explicit limitations.

### Modified Capabilities

- `engineering-gates`: include production dependency audit in the required CI aggregate.

## Impact

Depends on verified checkpoint 93f7f94 and archived mandatory MFA. Affects package
manifests/lockfile, reusable checks, CI aggregation and security documentation.
No schema, user-data, authentication contract or production deployment change.
Non-goals: unrelated major-version migrations, image/host scanning, full ASVS/DAST,
proxy/rate-limit behavior and final repository consolidation. Those remain required
later work. Existing owner Nginx/configuration/data remain preserved.
