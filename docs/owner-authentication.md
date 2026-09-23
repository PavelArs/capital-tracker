# Owner authentication: incremental implementation

The current change requires a password and a confirmed second factor before private
access. Operator enrollment, replacement and password recovery use trusted CLIs;
there is no public signup, email reset or MFA setup route. The MFA implementation
passed local release-image PostgreSQL and55 HTTPS Chromium checks. Consult the
archived `enforce-owner-second-factor` verification record for exact execution
evidence and limitations. Production rollout has not occurred.

Production rollout remains disabled. The application Compose configuration requires
an explicit host `MFA_KEY_FILE` and `MFA_KEY_ID`, binds that existing file read-only
at `/run/secrets/ct-mfa-key`, and passes the container path to the backend. Its bind
uses `create_host_path: false`; it cannot create a missing key source. The operator
must still arrange the private key, CLI access, exact HTTPS origin and explicit
migration step as part of a separately reviewed release. This wiring does not mean
that the production stack or full release pipeline has been run or verified.
The three authentication handlers use shared PostgreSQL request admission,
verified through two actual release-image replicas and process restarts.
Recent-MFA security settings, the full ASVS Level 2 matrix and security scans
remain required.

## Owner provisioning and password recovery

Run all explicit migrations first. The ninth adds the empty `owner_auth` binding,
the tenth adds `auth_sessions`, the eleventh adds encrypted MFA/recovery state
and extends sessions, and the twelfth adds only the request admission
ledger. The MFA migration revokes preceding session records, leaves users and
financial rows intact, and does not enroll anyone. The request-limit migration
preserves all existing owner, MFA, session and portfolio rows and is replay-safe.
Current binaries require all current explicit migrations, including the additive accounting tables. An owner without confirmed enrollment cannot log in.

The owner CLI uses explicit `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD` and
`DB_NAME` settings, with no implicit `.env` loading. Supply them through the trusted
operator's environment without printing credentials. After building the backend,
from `backend/`:

```sh
node dist/owner-cli.js bootstrap --email owner@example.com
node dist/owner-cli.js bootstrap --email owner@example.com --existing-user-id UUID
node dist/owner-cli.js recover --user-id UUID
```

The first command is for an empty installation. Existing users require the second
form with the exact selected ID and matching unambiguous email. Never infer the owner
from row order. Recovery must name the established owner; it cannot transfer ownership.
Both operations ask for a hidden password and confirmation. Passwords must contain
15–128 Unicode code points, at most 512 UTF-8 bytes, and no malformed Unicode or NUL,
CR or LF. Spaces and Unicode normalization are preserved. Passwords are not accepted
in argv or environment.

For controlled automation, append `--password-stdin` and supply a JSON object with
`password` and `confirmation` on stdin from a trusted secret source. Input is limited
to 4096 bytes. Avoid shell literals/history and logging the producer. There are no
default credentials. Isolated acceptance uses synthetic values through child-process
stdin; fixture files are excluded from production images.

Provisioning changes only the selected user's password and obsolete reset/verification
state and establishes its credential revision. Repeated or concurrent bootstrap cannot
replace an established owner. Recovery rotates that revision, revokes pending and
full sessions, cancels candidate enrollment and clears the owner's MFA cooldown in
one transaction. It preserves the confirmed factor, its consumed counter, unused
recovery codes, identity and portfolio data. A recovered password still requires
TOTP or a recovery code. Lost-factor recovery requires the separate explicit factor
replacement operation below.

Every authorized request checks the owner and current revision. Already authorized
in-flight operations can finish; subsequent authorization fails after revocation.
There is no legacy bearer or browser-storage authentication fallback. Passwords use
Argon2id with 64 MiB memory, three iterations, parallelism one and a library-generated
random salt. See the archived owner-provisioning verification record for its measured
release-image checks.

## MFA encryption key

The backend and MFA CLI require both `MFA_KEY_FILE` and `MFA_KEY_ID`. The file path
must be absolute and identify a regular, non-symlink file containing exactly 32 raw
random bytes, with permission mode 0400 or 0600. Hex or Base64 text is not a key-file
format. `MFA_KEY_ID` is a non-secret identifier of 1–64 ASCII letters, digits,
underscores or hyphens. Neither setting has a default.

Generate the key through a trusted local cryptographic source in an operator-owned
private directory. For example, after selecting and creating that directory, this
command creates a new file exclusively without printing the key or overwriting an
existing path:

```sh
node --input-type=module -e 'import { writeFileSync } from "node:fs"; import { randomBytes } from "node:crypto"; writeFileSync(process.argv[1], randomBytes(32), { flag: "wx", mode: 0o600 });' /absolute/private/mfa-key
```

Keep it outside the repository, images, database and ordinary application backups.
Arrange an encrypted, access-controlled key backup separately from the encrypted
secret database. Protect the parent directory from untrusted replacement of its
contents. Mount the same key read-only for the backend and trusted MFA CLI. When
launching a process directly, `MFA_KEY_FILE` is the key path in that process's filesystem.
In root Compose configuration it instead names the absolute host source; Compose sets
the backend process value to `/run/secrets/ct-mfa-key`. A separate CLI container needs
the same explicit mount and process settings. Release containers
run as UID 1000: ensure the private file is readable by that identity through correct
ownership, without broadening permissions to group/world access. Environment examples
leave both required MFA settings empty deliberately.

The server encrypts each TOTP secret with AES-256-GCM and authenticates its owner,
enrollment version, envelope format and key identifier. Missing or unsafe key
configuration prevents startup. Startup also checks existing active envelopes; a
wrong key or tampered envelope must fail closed. The key never resides in PostgreSQL.

Replacing the key file or identifier alone is not key rotation. There is no general
re-encryption CLI in this change. A planned rotation needs a separately reviewed,
backed-up procedure coordinating all encrypted envelopes and runtime configuration.
If the old key or factor is lost, trusted explicit enrollment replacement can create
a new factor without decrypting the old envelope; complete it with the intended key
before attempting normal startup. Password recovery alone cannot repair a lost key.

## Prepare, confirm and replace a factor

The MFA CLI requires the same explicit database settings, plus the exact HTTPS
`FRONTEND_URL`, `MFA_KEY_FILE` and `MFA_KEY_ID`. It does not implicitly load `.env`.
Use the established owner's UUID and a trusted private directory for each new output
file. Set the non-secret shell variables below to that UUID and new absolute paths;
the output paths must not already exist, including as symlinks.

```sh
# From backend/, after migration and owner provisioning:
node dist/mfa-cli.js prepare --user-id "$OWNER_USER_ID" --output "$MFA_PREPARE_OUTPUT"
node dist/mfa-cli.js confirm --user-id "$OWNER_USER_ID" --candidate-id "$MFA_CANDIDATE_ID" --output "$MFA_RECOVERY_OUTPUT"
```

`prepare` writes a new exclusive 0600 JSON file containing `uri`, `candidateId` and
`expiresAt`. Import the provisioning URI into a trusted authenticator locally; it
contains the secret and must not be pasted into an online QR generator, logs or
ordinary tickets. Read the candidate ID from that protected file for confirmation.
The candidate expires after ten minutes. A new prepare replaces an earlier pending
candidate but leaves any active factor usable.

`confirm` reads a hidden six-digit authenticator code. Controlled automation may add
`--code-stdin` and supply exactly the JSON field `code` as a six-ASCII-digit string
through stdin, bounded to 256 bytes. Preserve leading zeroes. Codes are not accepted
in argv or environment. Five wrong confirmation attempts exhaust that candidate;
prepare a new one after expiry or exhaustion.

Confirmation activates the candidate, consumes the accepted TOTP time step, rotates
the credential revision, revokes pending/full owner sessions and replaces recovery
codes in one database transaction. Its new exclusive 0600 JSON output contains only
`recoveryCodes`, an array of ten independent 128-bit codes. Each code has four groups
of eight hexadecimal characters separated by hyphens. Store these privately before
removing provisioning output no longer needed. The database stores only hashes bound
to the owner and enrollment; the CLI cannot display the codes again later.

After confirmation, wait for the authenticator's next unused step before browser
TOTP login, or use one issued recovery code after the password. Reusing the code
that confirmed enrollment is deliberately rejected.

To replace an active factor, explicitly add `--replace` to prepare, then confirm the
new candidate using the same confirmation flow and fresh output paths:

```sh
node dist/mfa-cli.js prepare --user-id "$OWNER_USER_ID" --output "$MFA_PREPARE_OUTPUT" --replace
```

The old active factor and recovery codes remain valid until successful confirmation.
Confirmation invalidates the old factor, old recovery codes and all pending/full
owner sessions. Failed confirmation or output publication must leave the active
factor and financial data unchanged. No command transfers ownership.

## Private output failures and uncertain commits

The CLI creates output files exclusively and verifies their type, permissions and
identity. It flushes and closes the protected output before beginning the database
commit. An ordinary failure before completed publication rolls back database changes
and removes only the incomplete file created by that invocation, if the path still
identifies that same inode. It never overwrites or unlinks a replacement file.

PostgreSQL and the filesystem cannot commit atomically. A crash or an error after
publication may leave a protected output even if the command exits unsuccessfully.
The CLI retains published output when the commit outcome is uncertain. Preserve
that file and its permissions; do not treat the exit code alone as proof that the
factor stayed unchanged or blindly retry against the same path.

Using a trusted database connection, compare the bound owner and prepared candidate
ID with non-secret enrollment metadata (`userId`, `activeVersion`, `candidateId`,
`candidateExpiresAt`) in `owner_mfa`. An `activeVersion` matching the candidate
identifies that confirmed enrollment; retain its recovery output. A matching pending
candidate requires further confirmation. Reconcile concurrent operator activity and
ambiguous state before retrying or deleting protected output. Use a fresh exclusive
output path for any approved retry. This procedure is a recovery check, not a claim
of atomic file/database publication or a replacement for tested backups.

## Browser sessions and HTTPS configuration

Set `FRONTEND_URL` to the exact browser HTTPS origin, for example
`https://127.0.0.1:8443` in isolated acceptance. It must contain no path, trailing
slash, credentials, query or fragment. `localhost` and `127.0.0.1` are different
origins. Use `VITE_API_URL=/api` behind the same HTTPS proxy, which forwards `/api/`
to the backend. The browser supplies Origin; the server never trusts Host or forwarded
headers to derive it. Express proxy trust remains disabled.

HTTP startup also requires `TRUSTED_PROXY_IPS`, a JSON string array of zero to eight
exact socket peer IP literals. `[]` explicitly selects direct mode; all forwarded
addresses are ignored in that mode. Missing/blank values, hostnames, ports, CIDRs,
IPv6 zones and canonical duplicates fail startup. Migration and owner/MFA CLIs do
not require this HTTP-only setting.

Before an upgrade, verify the TCP peer the backend actually observes for a request
from the sole HTTPS edge. Use host/container socket inspection or the existing
backend request log's `remoteAddress` in an isolated rehearsal. Do not copy
`X-Forwarded-For`, a browser address, or the synthetic test network addresses into
production configuration. A host Nginx reaching a published container port may
appear as a bridge gateway rather than loopback; Docker inspection alone does not
prove the address on that path. Restrict access to the backend port, record the
observed exact peer, configure the JSON array, and verify again after network
recreation. Complete this rehearsal before restarting an existing HTTP service;
no public rollout is implied by these instructions.

The owned `deploy/nginx.conf` template strips `/api/`, replaces `X-Forwarded-For`
and `X-Real-IP` with its socket client address, supplies its own scheme and removes
`Forwarded`/`X-Forwarded-Host`. It supports one edge only; do not add `real_ip`,
PROXY protocol or another CDN/proxy without revisiting this contract. The HTTP
redirect uses the configured domain. Preserve the complete server-level header
set: adding a location-level `proxy_set_header` prevents inheritance of that set.
The separate owner `frontend/nginx.conf` is not rewritten by this change.

Only CSRF retrieval, password login and MFA quotas use this attribution. An exact
trusted peer must supply one raw `X-Forwarded-For` field containing one strict IP
literal; otherwise those handlers return generic 400/no-store before any quota,
session or factor work, even after a bucket is exhausted. Untrusted peers use
their socket address and ignore forwarding headers. IPv4-mapped IPv6 becomes IPv4;
IPv4 quotas group by /32 and ordinary IPv6 by /64, while peer trust always compares
the entire canonical address. Source trust grants no authentication or CSRF/Origin
exception. Existing 401/403 examples assume valid source metadata and available quota.

## Shared authentication admission

The three matched handlers commit admissions in PostgreSQL before session or credential work. The fixed windows are
exactly 30 requests per 60 seconds for a verified source on CSRF, 5 per 60
seconds for a verified source on password login, and 5 per 60 seconds for a
verified source on MFA. Password login also charges 10 requests per 600 seconds
for the normalized claimed email (trimmed and lowercased), shared across sources.
These budgets are shared across replicas and survive restarts.

The source identity keeps the existing trusted-peer and forwarding-header
contract. Both the source IP and claimed email are stored only as SHA-256 subject
digests; these unsalted digests do not anonymize guessable identifiers. The
ledger is capped at 4096 live rows: pruning may remove expired rows, but admission
never evicts a live budget, and an existing under-limit subject remains usable at
capacity. Fixed windows begin at fresh PostgreSQL time, do not slide on denial,
and successful login, recovery, enrollment or restart does not reset them.
Existing MFA challenge limits remain independent: five wrong factors retire a
challenge and the persistent owner cooldown still enforces its ten-failure policy
across replicas and restarts.

For a well-formed request, source admission is charged before authentication work.
Password login charges the claimed-email budget only after valid DTO parsing,
session authorization, exact Origin and CSRF checks; MFA follows the same
authorization boundary. Malformed trusted-source metadata is rejected before
admission and spends zero budget. Malformed JSON rejected by the HTTP parser is
outside admission and likewise spends zero budget.

An exhausted source, account or capacity window returns generic 429 with
`Cache-Control: no-store` and an integer `Retry-After` (1–60 seconds for source
windows, 1–600 seconds for account or capacity). Connection, lock, query or
commit failure returns generic 503 with `no-store`; there is no memory fallback,
automatic retry or late admission after pool refusal. Admission uses PostgreSQL;
Redis remains part of the existing application cache. The runtime
`connectTimeoutMS=5000` bound applies to every runtime PostgreSQL pool checkout
and new connection, not only admission. It does not bound total HTTP or Nest
startup time or impose retry behavior outside the pool connection path. A finite
ledger and pool still limit availability; these controls do not guarantee service
availability.

Requests refused by source or claimed-account admission remain read-only: they
do not rotate or touch a session, look up credentials or verify a password.
Authorization rejections likewise leave the session unchanged, while later
factor failures retain their existing counter and challenge-retirement behavior.
Successful authentication increments its applicable budget normally without
resetting the window; CLI recovery and enrollment add zero request admissions.
The existing proxy-trust and Nginx contracts remain unchanged.

Authentication uses the host-only `__Host-ct-session` cookie with Secure, HttpOnly,
SameSite=Strict and Path=/ attributes. Raw tokens are independent random 256-bit
values; only SHA-256 hashes are stored in PostgreSQL. HTTP-only local login is
unsupported: Vite and backend HTTP development ports alone do not provide a working
login path. The route paths below are relative to the backend; the HTTPS proxy adds
its `/api` prefix.

| Operation | Contract |
|---|---|
| `GET /auth/csrf` | Returns `{ csrfToken }`; reuses a valid session or creates an anonymous one. A supplied Origin must match. The frontend keeps the token only in memory. |
| `POST /auth/login` | Requires exact Origin, a session cookie and bound `X-CSRF-Token`. Correct owner credentials and confirmed enrollment consume the old session and issue a five-minute pending cookie with `{ mfaRequired: true, csrfToken }`. There is no user or private access yet. Unenrolled owners receive generic 401. |
| `POST /auth/mfa` | Requires a password-derived pending cookie, exact Origin and its CSRF token, plus `{ kind: 'totp' \| 'recovery', code: string }`. Success consumes pending state and issues a new full cookie with `{ user, csrfToken }`. |
| `GET /auth/me` | Requires full authentication. Pending/anonymous cookies cannot restore a profile. Browser startup removes the obsolete localStorage `token` key. |
| `POST /auth/logout` | Requires a pending or full cookie, Origin and CSRF. Deletes that session and clears the cookie, returning 204. The UI clears full user state only after success. |

The Russian login form separates password and factor steps and offers recovery-code
entry. Full user/navigation state appears only after factor verification. Reloading
a pending login may return to the password form. Re-entering the password can replace
pending state. Every successful rotation installs the new in-memory CSRF token.

Every matched state-changing route requires Origin and CSRF. Failed CSRF writes are
rejected; the client refreshes CSRF for a later explicit retry and never automatically
replays the mutation. Controller routes are private by default; explicit public
endpoints are CSRF retrieval, password login and minimal `GET /health`
(`{"status":"ok"}`). MFA completion and logout explicitly allow pending state without
bypassing authentication or CSRF. Detailed health and the backend root require full
authentication. Auth/private responses use `Cache-Control: no-store`. There is no
public HTTP Swagger/documentation route.

Anonymous and pending sessions last five minutes. Full sessions expire after twelve
hours absolutely or thirty minutes idle, measured with PostgreSQL time after relevant
lock waits. Activity cannot extend the absolute deadline. Revocation and expiry survive
restarts. The combined anonymous/pending pool is capped at 512 without evicting live
entries; a full pool returns 429. Full sessions are capped at ten, retiring the oldest
full sessions when another successful factor completion exceeds that limit.

## Factor replay and guessing limits

TOTP uses pinned `otpauth@9.5.2`, SHA1, six ASCII digits, 30-second steps and a one-step
drift window. PostgreSQL time determines eligibility. The accepted counter must be
strictly greater than the previously consumed counter, including confirmation and
concurrent requests. Each recovery code can issue one full session; code consumption
and session creation share a transaction. Recovery codes accept ASCII hex in either
case with the exact hyphenated format. Whitespace, unhyphenated values, Unicode digits
and non-string codes are malformed 400 responses and do not spend guesses.

Wrong or replayed well-formed factors spend guesses. The fifth failed attempt retires
that pending challenge and returns 401. Ten failures within the owner's ten-minute
window begin a ten-minute cooldown; the tenth and blocked completion attempts return 429.
Renewing a challenge, restarting the backend or spoofing forwarding headers cannot
reset the persisted owner block. Blocked attempts do not extend its deadline. Expiry,
successful factor completion, trusted confirmation or password recovery clears the
relevant failure state. The shared source and claimed-account admissions
are separate from this persistent owner/challenge cooldown. Do not reset either
ledger during a test case to make a later factor phase pass; use the real
two-replica path and record the expected ledger deltas.

## Threat model and remaining controls

| Threat | Current boundary | Still required |
|---|---|---|
| Anonymous account creation/email recovery | Removed routes/forms; CLI-only owner provisioning and enrollment | Complete route audit, distributed request limits and DAST |
| Retained non-owner, expired cookie or legacy bearer | Owner/revision checks, protected opaque cookie, server expiry/revocation; no bearer fallback | Full ASVS mapping and broader negative acceptance |
| Stolen owner password | Password produces only pending state; mandatory TOTP or single-use recovery code | Phishing-resistant options and distributed abuse controls |
| Stolen full cookie | Short idle/absolute lifetime, server logout and CLI revocation | Recent-MFA checks for sensitive settings, XSS/CSP hardening |
| Replayed factor or concurrent recovery code | Monotonic TOTP counter and transactional code/session consumption | Continuing concurrency and availability review |
| Cross-site writes | Exact configured HTTPS Origin and bound CSRF, no implicit proxy trust | Broader browser/proxy review and XSS defenses |
| Guessing or session exhaustion | Persisted owner/challenge MFA limits and transactional session caps | Shared password/IP limits and operational capacity tests |
| Credential or output leakage | Argon2id, encrypted factors, hashed recovery codes, private CLI outputs, safe errors and redaction | Full secret/image/log scanning and backup/restore exercises |
| Malicious CSV content | Strict bounded UTF-8/parser/input validation, literal React rendering, private retained originals and generic storage errors; see [CSV import](csv-imports.md) | Full expanded release verification, broader XSS/CSP and resource-exhaustion review |
| Malicious provider/news content | Isolated acceptance denies live egress | SSRF allowlists, provider validation and AI isolation |
| Dependency or CI compromise | Pinned dependencies/actions, isolated image tests and disabled rollout | Dependency/image/static scans and immutable artifact promotion |
| Stolen backup, host or device | Factor key separated from database; no real credentials used in acceptance | Encrypted backups, least privilege and host/device hardening |

TOTP is not phishing resistant and application login cannot solve host/device
compromise. This is an initial threat model, not a complete ASVS mapping or
certification. Do not restore password-only or public legacy auth as a recovery
procedure. Any actual production upgrade needs a separately reviewed backup/release
procedure and explicit authorization.
