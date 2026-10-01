## Why

The application has useful tested modules but CI aggregation omits Docker failures
and production deployment runs independently of CI. Establish an honest repeatable
baseline and fail-closed engineering gate before changing private data.

## What Changes

- Record repository selection, baseline commands, inventory and migration risks.
- Add project OpenSpec/agent instructions and retained-behavior characterization.
- Test a reusable CI-result gate rejecting failure, cancellation and skipped required jobs, including Docker and specs.
- Gate legacy deployment behind manual invocation and a disabled-by-default owner rollout switch pending release hardening.
- Record runtime/test incompatibilities without hiding failures.

Non-goals: authentication replacement, accounting, providers, schema changes,
production deployment and folder deletion. These remain follow-up slices of the
full brief. Dependencies: none. Data impact: no schema/data mutation.

## Capabilities

### New Capabilities
- `engineering-gates`: auditable baseline, complete CI aggregation and controlled deployment entry.

### Modified Capabilities
None; no existing OpenSpec product contracts were found.

## Impact

AGENTS/OpenSpec/docs, root engineering scripts/tests, CI/CD gates and characterization
tests. Retain pnpm, NestJS, TypeORM, React/Vite, Chart.js, GHCR and /opt/capital-tracker.
No product behavior change in this slice.
