## MODIFIED Requirements

### Requirement: ENG-003 Evidence and retained characterization
The repository SHALL document baseline commands, pre-existing failures, data risks
and keep/simplify/remove decisions. It SHALL retain executable characterization
for private guard denial and ownership-scoped wallet access without changing behavior.

#### Scenario: CHAR-AUTH-001 Absent or malformed authentication
- **GIVEN** the real global session guard
- **WHEN** the guard evaluates absent or malformed session cookies
- **THEN** the guard denies access with UnauthorizedException and attaches no authenticated identity

#### Scenario: CHAR-WALLET-001 A wallet is not owned by the caller
- **GIVEN** lookup is constrained by the caller's owner ID
- **WHEN** the owner-scoped wallet does not exist
- **THEN** reading, deleting or refreshing the wallet fails without outbound provider refresh

#### Scenario: ENG-003-A Honest verification
- **GIVEN** baseline command results and independent review findings
- **WHEN** the audit and verification records are written
- **THEN** executed checks, failures and unexecuted database/browser checks are distinguished
- **AND** no schema migration, data deletion or production rollout is performed
