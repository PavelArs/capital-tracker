## ADDED Requirements

### Requirement: LIMIT-001 Shared stable authentication request budgets
CSRF, password and factor handlers SHALL commit per-source admissions in PostgreSQL
before session or credential work. Explicit handler policies SHALL share 30/60s
csrf-ip, 5/60s login-ip and 5/60s mfa-ip fixed windows across processes, restarts and
equivalent handler paths. Source identity SHALL retain the verified exact-peer
attribution contract. Other endpoint quotas remain unchanged.

#### Scenario: LIMIT-001-A A second real replica cannot grant additional guesses
- **GIVEN** two real backend replicas sharing PostgreSQL and the verified HTTPS edge
- **WHEN** real client A submits five wrong passwords to replica one and a sixth to replica two
- **THEN** the first five return401 and the sixth returns429
- **AND** actual upstream evidence identifies both processes and B retains independent source allowance

#### Scenario: LIMIT-001-B Process restarts preserve all three budgets
- **GIVEN** independently exhausted CSRF, password or factor source windows
- **WHEN** both actual replicas restart and are independently healthy
- **THEN** the exhausted handler still returns429 before session/factor work
- **AND** its stored hits and deadline remain unchanged until expiry

#### Scenario: LIMIT-001-C Concurrent requests share exactly one remaining budget
- **GIVEN** A's genuine anonymous cookie and available account quota
- **WHEN** ten concurrent wrong-password requests reach both real replicas
- **THEN** exactly five return401 and five return429
- **AND** PostgreSQL records exactly five source and five account admissions with no full session

#### Scenario: LIMIT-001-D Handler variants cannot create new budgets
- **WHEN** thirty CSRF requests use GET/HEAD and equivalent case, query and trailing-slash paths
- **THEN** they share one source policy and the next returns429 without session allocation or touch
- **AND** B retains its own CSRF budget

### Requirement: LIMIT-002 Claimed-account admission precedes password verification
After successful session/Origin/CSRF checks and DTO validation, password login SHALL
commit a 10/600s login-account admission for the existing trimmed lowercase claimed
email before credential owner lookup or real/dummy Argon2 verification. Session
authorization still checks its existing owner binding/revision. The same policy SHALL
apply to owner and unknown addresses, with no raw email/IP stored in ledger rows.

#### Scenario: LIMIT-002-A Normalized account requests aggregate across sources
- **GIVEN** A and B each make five wrong-password attempts with case and whitespace variants of one valid email
- **WHEN** only the synthetic source windows are explicitly expired and a correct password is submitted
- **THEN** the account limit returns429, retaining its ten hits and original deadline
- **AND** only the new source admission is spent, with no session rotation or lastSeenAt change
- **AND** the same ten-admission policy holds for an unknown email

#### Scenario: LIMIT-002-B Invalid authentication stages have precise accounting
- **WHEN** valid-source requests have invalid cookie, Origin, CSRF or parsed credential DTO
- **THEN** they consume only source admission and preserve existing401/403/400 behavior under quota
- **AND** no account admission or password verifier call occurs
- **AND** malformed trusted source metadata consumes neither admission

#### Scenario: LIMIT-002-C Admission denial avoids expensive credential work
- **WHEN** source/account capacity is exhausted or ledger storage fails
- **THEN** password verification and the credential owner's lookup are not invoked
- **AND** real HTTP tests preserve exact session/MFA/recovery/financial state, including a full-session re-login's lastSeenAt

### Requirement: LIMIT-003 Fixed windows use fresh database time
Windows SHALL begin on first admitted PostgreSQL time and never slide on denial.
The admission at the configured limit SHALL succeed; later attempts SHALL fail
until deadline equality or later. The service SHALL use fresh database time after
all advisory, pruning and target-row lock waits, without host-clock decisions.
Success, CLI recovery and enrollment SHALL NOT reset request admissions.

#### Scenario: LIMIT-003-A Denial and success do not reset windows
- **WHEN** an existing live window rejects attempts or authentication/CLI recovery succeeds
- **THEN** denial and CLI operations preserve its hits and original start/deadline
- **AND** a successful admitted authentication request increments its applicable budget normally without resetting prior hits or deadlines
- **AND** its next expiry permits a new window with one admission

#### Scenario: LIMIT-003-B Expiry during lock waits uses the post-wait clock
- **GIVEN** real PostgreSQL target or pruning locks held across a synthetic deadline
- **WHEN** admission resumes before the configured lock timeout
- **THEN** expired rows cannot block or extend the new window
- **AND** live capacity is evaluated using fresh database time without reviving expired state

### Requirement: LIMIT-004 Ledger capacity is bounded without evicting live budgets
The additive ledger SHALL contain at most4096 live rows across all four scopes.
Rows SHALL contain constrained policy, SHA256 subject digest, hits and finite window
timestamps. Admissions SHALL serialize capacity decisions, prune expired rows and
never evict a live budget. Existing live under-limit rows SHALL remain usable at
capacity. Hashes bound stored identifiers and do not imply anonymity.

#### Scenario: LIMIT-004-A Two processes race for the last live slot
- **GIVEN** 4095 live rows in an allowlisted disposable PostgreSQL database
- **WHEN** two actual processes admit distinct new subjects concurrently
- **THEN** exactly one admission succeeds and one is capacity-denied, leaving4096 live rows
- **AND** every prior live row remains and an existing under-limit subject can still increment

#### Scenario: LIMIT-004-B Expired state releases capacity
- **WHEN** a synthetic ledger row reaches its deadline and a new subject is admitted
- **THEN** expired state is pruned and the new row starts at one
- **AND** no live budget is removed or extended

### Requirement: LIMIT-005 Safe denial and storage-failure semantics
Request/capacity denial SHALL return429 with generic Too many requests, no-store and
integer Retry-After based on the relevant deadline, clamped1..60 for source,1..600
for account/capacity. Connection, lock, query or commit failure SHALL return generic
503 Authentication service unavailable, no-store, with no raw driver or subject
details. There SHALL be no memory fallback or automatic retry after ambiguous commit.

#### Scenario: LIMIT-005-A Denial headers reflect unchanged deadlines
- **WHEN** the same exhausted window is probed repeatedly before expiry
- **THEN** Retry-After is a bounded integer and does not increase without a new window
- **AND** no session or credential work occurs and stored hits/deadline remain unchanged

#### Scenario: LIMIT-005-B Storage failure fails closed before authentication
- **GIVEN** a real PostgreSQL admission lock held beyond its bounded timeout
- **WHEN** a valid real HTTPS login or factor attempt reaches admission
- **THEN** it returns503/no-store with safe generic text and preserves authentication/financial rows
- **AND** release of the lock permits an explicit later retry when allowance remains
- **AND** controlled connection/query/commit error probes show no internal retry or leaked runner

#### Scenario: LIMIT-005-C Exhausted connection pools cannot defer admission past refusal
- **GIVEN** every connection of a small real PostgreSQL fixture pool is held, using the production5000ms acquisition timeout
- **WHEN** admission attempts to acquire a connection
- **THEN** it fails503 within the configured bound plus scheduling tolerance, without state mutation
- **AND** releasing connections does not execute a late admission; a new explicit attempt succeeds

### Requirement: LIMIT-006 Additive migration and retained owner protection
Migration12 SHALL add only the request ledger and preserve the prior eleven-migration
owner, encrypted MFA, recovery, session and financial rows. Existing MFA five-attempt
challenge retirement and ten-failure owner cooldown SHALL remain independent of
request budgets. Verification SHALL retain existing browser/security oracles with
explicit expected ledger deltas, never a production limiter bypass.

#### Scenario: LIMIT-006-A Previous data survives upgrade and replay
- **GIVEN** a populated synthetic eleven-migration schema with all session classes and used/unused factor state
- **WHEN** migration12 and replay run through the actual CLI
- **THEN** all prior table rows remain identical and the new ledger is initially empty
- **AND** fresh installation records twelve migrations exactly once and historical destructive upgrades remain refused

#### Scenario: LIMIT-006-B Persistent owner cooldown is still independently enforced
- **WHEN** A makes five wrong factor attempts, both replicas restart, then B makes five and both restart again
- **THEN** both challenges retire, owner failure counts progress5 then10, and no full session is issued
- **AND** a third genuine source remains blocked by the unchanged owner cooldown despite spoofed headers/restarts
- **AND** the original explicit owner-expiry fixture still permits real recovery afterward, without clearing request state between phases
