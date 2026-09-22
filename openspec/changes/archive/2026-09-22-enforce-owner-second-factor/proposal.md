## Why

The verified cookie boundary still grants full access after a password alone. The
target requires a mandatory second factor, protected enrollment and replay-safe
recovery before private access, including after upgrading existing installations.

## What Changes

- **BREAKING**: password login issues only a short-lived pending session. TOTP or a
  single-use recovery code must complete authentication before private access.
- Add CLI-only prepare/confirm enrollment with encrypted secrets, explicit owner
  identity, protected output files and safe factor replacement.
- Add atomic counter/code consumption, challenge/account guessing limits and a
  Russian second-factor form. Preserve all financial/user records.
- Revoke pre-MFA session records during an explicit additive schema upgrade.

## Capabilities

### New Capabilities

- `owner-second-factor`: encrypted enrollment, mandatory second factor, replay-safe
  recovery and bounded verification.

### Modified Capabilities

- `owner-sessions`: pending MFA state and second rotation before full privileges.
- `owner-provisioning`: password recovery preserves MFA while revoking sessions.
- `isolated-release-acceptance`: real browser authentication includes a second factor.
- `explicit-migrations`: fresh and preceding-ten-schema preservation with old-session revocation.

## Impact

Depends on archived owner provisioning and cookie sessions. Changes auth/CLI/session
schema, frontend login, environment examples and isolated fixtures; pins OTPAuth9.5.2.
No hosted service, owner database access, spending keys, production rollout or
repository consolidation. Full distributed password/IP throttling, recent-MFA
security settings, ASVS/scanners and release hardening remain separate required work.
