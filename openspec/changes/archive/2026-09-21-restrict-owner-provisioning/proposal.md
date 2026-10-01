## Why

Public registration and email recovery conflict with the single-owner target. Legacy
JWTs also remain usable after password reset, including tokens belonging to retained
non-owner accounts. Establish one explicit owner without deleting financial history.

## What Changes

- **BREAKING** Remove registration, email verification/resend and email password-reset
  APIs, forms, client methods and unused email dependencies.
- Add CLI-only bootstrap and password recovery, Argon2id password hashing and an
  additive database-enforced owner binding. Existing accounts require explicit ID
  selection; never infer an owner or delete other accounts.
- Require the current owner and credential revision for login and every transitional
  JWT request. Recovery rotates the revision and invalidates earlier bearer tokens.
- Verify real CLI provisioning, recovery, authorization and data preservation through
  release images, PostgreSQL and HTTPS Playwright.

## Capabilities

### New Capabilities
- `owner-provisioning`: CLI owner lifecycle, bounded password handling, disabled public
  provisioning and owner/revision checks for the transitional authentication boundary.

### Modified Capabilities
- `explicit-migrations`: Fresh migration acceptance includes additive migrations;
  an already-current schema upgrades without rewriting existing data.
- `isolated-release-acceptance`: The synthetic owner is provisioned with the production
  CLI before real browser login instead of relying on a direct bcrypt fixture alone.

## Impact

Depends on the archived baseline and isolated acceptance changes. Affects backend
authentication, one additive migration, CLI, frontend authentication routes, fixtures
and operational instructions. Only the explicitly selected owner's credentials change;
all portfolio rows and other users remain intact. No real database is accessed.

Non-goals for this slice: mandatory TOTP, opaque cookie sessions, session CSRF,
distributed throttling, full ASVS mapping/scanners and production release. Existing
password-only JWT/localStorage authentication remains transitional; rollout stays
disabled and this change is not production-readiness evidence.
