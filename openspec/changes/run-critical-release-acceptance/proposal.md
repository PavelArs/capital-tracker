## Why

The temporary hosted E2E pause produces build and scan evidence but no tested release candidate. The owner has now authorized a shorter real release acceptance profile so a candidate can be tested in GitHub Actions while the broad browser suite remains available.

## What Changes

- Add a reviewed critical browser selection with exact source titles, including CSV recovery through real session expiry and MFA.
- Run the existing isolated HTTPS, provider, PostgreSQL, migration, domain, CLI, startup and artifact checks for both full and critical profiles; only browser selection differs.
- Bind a machine-readable success receipt to profile, selected scenarios, source commit and CI run; reject skipped, partial or ambiguous execution.
- Permit tested candidate export and CD promotion only after the exact critical release gate and receipt succeed.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `engineering-gates`: replace the temporary hosted acceptance pause with a fail-closed critical release profile and candidate provenance.

## Impact

Only test selection, acceptance scripts, CI/CD policy and engineering contract checks change. Application code, database schema, authentication, lockfiles and the production server are unchanged. The full `pnpm test:e2e` command remains available. Dependencies are the existing release infrastructure and successful non-E2E CI prerequisites. This change does not perform hosted acceptance, image promotion, backup/restore, server deployment or archive the open release changes.
