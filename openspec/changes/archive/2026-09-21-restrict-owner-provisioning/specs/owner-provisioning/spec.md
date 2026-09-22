## ADDED Requirements

### Requirement: OWN-001 Explicit singleton owner bootstrap
Owner bootstrap SHALL be a CLI-only transaction, with a database-enforced singleton
binding and no default credentials. Existing accounts MUST require explicit ID
selection and matching unambiguous email; all financial data and other users MUST remain.

#### Scenario: OWN-001-A Fresh bootstrap and concurrency
- **GIVEN** a migrated empty database
- **WHEN** bootstrap commands run concurrently with valid matching passwords
- **THEN** exactly one command succeeds and exactly one user and owner binding exist
- **AND** repeat bootstrap cannot replace credentials or create another user

#### Scenario: OWN-001-B Existing owner selection preserves history
- **GIVEN** existing users and wallets with no owner binding
- **WHEN** bootstrap selects an existing user by exact ID and matching email
- **THEN** that user ID is bound and only its credentials and verification/reset fields change
- **AND** all portfolio rows and other users remain unchanged

#### Scenario: OWN-001-C Invalid selection is atomic
- **GIVEN** existing users without a binding
- **WHEN** bootstrap omits the ID or supplies unknown ID, mismatched or ambiguous email
- **THEN** it fails without changing users, portfolios or owner binding

### Requirement: OWN-002 Bounded private credential handling
Passwords SHALL use maintained Argon2id with 65536 KiB memory, three iterations,
parallelism one and random salts. Password input SHALL preserve Unicode and whitespace,
require 15–128 code points and at most 512 UTF-8 bytes, and reject malformed Unicode and NUL/CR/LF. CLI input
SHALL be hidden TTY confirmation or explicit bounded stdin JSON; passwords MUST NOT
be accepted through argv or environment. Secrets MUST NOT appear in errors or logs.

#### Scenario: OWN-002-A Password storage and verification
- **WHEN** the owner is bootstrapped or recovered with a valid password
- **THEN** PostgreSQL stores an Argon2id hash with the specified parameters and no plaintext
- **AND** exact password verification succeeds while a changed password fails

#### Scenario: OWN-002-B Invalid input fails before database access
- **WHEN** the CLI receives invalid, mismatched, oversized or unsupported input
- **THEN** it exits nonzero with a safe explanation before connecting or hashing
- **AND** missing DB configuration and connection failures disclose no credentials

### Requirement: OWN-003 Owner-only transitional authentication and recovery
Password login and every JWT-authenticated request SHALL verify the current singleton
owner and credential revision. Missing binding, legacy or stale tokens and non-owner
credentials MUST fail generically. CLI recovery MUST target the established owner,
replace its password and rotate the revision atomically, preserving financial history.

#### Scenario: OWN-003-A No implicit owner or legacy bearer access
- **GIVEN** no owner binding, or a retained non-owner account
- **WHEN** its valid password or previously signed JWT is used
- **THEN** private access returns 401 without private data

#### Scenario: OWN-003-B Real login and recovery revocation
- **GIVEN** the explicitly provisioned owner has logged in through real HTTPS
- **WHEN** the CLI recovers that owner's password
- **THEN** the previous password and bearer token both fail with 401
- **AND** the new password logs in through the browser and financial rows are unchanged

#### Scenario: OWN-003-C Recovery cannot transfer ownership
- **WHEN** recovery supplies a missing or different user ID
- **THEN** it fails without changing the owner, credentials or any portfolio data

### Requirement: OWN-004 No public signup or email recovery
Registration, email verification/resend and email password-reset routes SHALL be
unavailable, including their frontend forms and API helpers. No email service SHALL
be required for owner authentication or recovery.

#### Scenario: OWN-004-A Removed APIs have no side effects
- **WHEN** an anonymous client calls each removed auth API through HTTPS
- **THEN** the response is 404 and user/owner/portfolio state remains unchanged

#### Scenario: OWN-004-B Browser exposes only login
- **WHEN** an anonymous browser opens login or a former signup/recovery URL
- **THEN** only the login form is reachable, with Russian owner-access guidance
- **AND** signup and email recovery links/forms are absent
