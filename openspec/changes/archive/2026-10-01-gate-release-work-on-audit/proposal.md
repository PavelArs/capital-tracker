## Why

The release image and real acceptance job can start even after the production dependency audit fails because it currently waits only for application builds and tests. Known audit or specification failures should prevent this costly release work from starting while preserving fail-closed final CI results.

The owner additionally requested a temporary CI E2E pause on 2026-10-01 because the suite is too costly. Successful paused CI must remain distinguishable from full acceptance and must not enable release promotion.

## What Changes

- Require successful `dependency-audit` and `spec-check` jobs before the release job can run.
- Add executable workflow graph and bypass rejection assertions with actual predecessor RED and candidate GREEN evidence.
- Preserve the existing application prerequisites, full acceptance command, image security/export gates and aggregate.
- Add a source-controlled E2E switch defaulting to false, retain image builds/scans, and suppress candidate export while acceptance is paused.
- Require actual successful full-acceptance step provenance before promotion, preflight or deployment.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `engineering-gates`: Add ENG-004 release scheduling prerequisites for audit and specification/security checks.

## Impact

Only `.github/workflows/ci.yml`, `.github/workflows/cd.yml`, backend engineering policy tests and this OpenSpec change. No runtime, data, migration, dependency or lockfile changes. Depends on the existing audit/specification jobs and fail-closed aggregate. Non-goals: dependency remediation, deleting browser coverage, timeout changes, local Docker/server work, release promotion or deployment. The owner's temporary E2E override supersedes the prior requirement to run the suite on every CI run; retained manual and enabled CI execution still use complete coverage.
