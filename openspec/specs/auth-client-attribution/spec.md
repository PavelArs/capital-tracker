# auth-client-attribution Specification

## Purpose
Attribute authentication request quotas to canonical client sources using explicit exact proxy trust and a verified sanitizing HTTPS edge.
## Requirements
### Requirement: PROXY-001 Exact explicit source attribution
HTTP startup SHALL require TRUSTED_PROXY_IPS as a JSON array of zero to eight exact
literal peer addresses. Empty array SHALL select direct mode. Invalid or missing
configuration MUST fail startup. Only exact canonical socket peers may supply the
single client address used by the CSRF, login and MFA request quotas.

#### Scenario: PROXY-001-A Different real clients have independent quotas
- **GIVEN** one actual backend and two real HTTPS clients A/B behind the trusted Nginx edge
- **WHEN** A submits five wrong valid-shaped passwords then a sixth attempt
- **THEN** A receives five 401 responses and then 429
- **AND** B can still submit the correct password, complete a real second factor and access its private profile
- **AND** financial rows are unchanged and no synthetic authenticated cookie is injected

#### Scenario: PROXY-001-C CSRF and MFA have the same source isolation
- **GIVEN** separate real HTTPS clients A/B and independent scenarios with available owner-factor budget
- **WHEN** A uses its 30 CSRF admissions or five well-formed invalid factor admissions
- **THEN** A's next same-handler request is 429 while B can still retrieve CSRF or complete its real unused factor respectively
- **AND** the five MFA failures retain their existing challenge/owner accounting and confer no full access

#### Scenario: PROXY-001-B Invalid peer configuration fails before serving requests
- **WHEN** configuration is missing, invalid JSON, not an array, over eight entries, or contains nonstrings, hostnames, CIDRs, ports, zones, shorthand IPv4 or canonical duplicates
- **THEN** HTTP startup fails with a safe error
- **AND** explicit [] accepts direct mode without trusting forwarding headers

### Requirement: PROXY-002 Forwarded headers cannot choose a rate identity
Untrusted socket peers SHALL use their actual address regardless of supplied headers.
Trusted peers MUST provide exactly one raw X-Forwarded-For header with one strict IP
literal. Missing, malformed, duplicate or list values MUST return generic 400 before
quota accounting, session, factor or financial operations, including when an otherwise
applicable request quota is exhausted. Neither source attribution nor a trusted
peer SHALL replace exact-Origin/CSRF validation or supply an owner identity.

#### Scenario: PROXY-002-A Forgery through the real edge cannot reset or target quotas
- **GIVEN** A has exhausted its login quota while B still has allowance
- **WHEN** A varies X-Forwarded-For, X-Real-IP, Forwarded, Host and X-Forwarded-Proto through the real HTTPS edge
- **THEN** A remains limited and B's quota is unaffected
- **AND** under available quota a foreign Origin remains 403 without authentication-state mutation

#### Scenario: PROXY-002-B Malformed trusted metadata is rejected before state changes
- **GIVEN** a real request from the exact trusted peer with absent, duplicate, comma-list or invalid-literal X-Forwarded-For
- **WHEN** it reaches a CSRF, password or factor handler, including with a valid full/pending session
- **THEN** it returns 400 with no-store and exact session/MFA/recovery/financial fingerprints remain unchanged
- **AND** rejected metadata consumes no request slots: five subsequent valid-shaped login attempts remain available, while malformed metadata still returns 400 after quota exhaustion
- **AND** a direct untrusted peer with forged victim headers uses its own rate identity

### Requirement: PROXY-003 Canonical identity and bounded IPv6 grouping
Source parsing SHALL use strict standard IP literals. IPv4-mapped IPv6 SHALL become
IPv4 before rate grouping. Exact proxy trust MUST compare the entire canonical
address; ordinary IPv6 request quotas SHALL group the first 64 bits, IPv4 all 32.

#### Scenario: PROXY-003-A Equivalent sources share buckets without expanding trust
- **WHEN** canonical vectors cover mapped IPv4, equivalent IPv6 spellings, same-/64 IPv6 and different-/64 IPv6
- **THEN** equivalent rate groups share a bucket and distinct groups remain independent
- **AND** an untrusted address in a trusted proxy's /64 cannot supply a client address

### Requirement: PROXY-004 Sanitizing verified deployment edge
The owned deployment Nginx template SHALL overwrite client forwarding headers from
its actual socket address, remove unsupported forwarding identity headers, and strip
the browser /api prefix when forwarding to backend routes. The owner checkout Nginx
file MUST remain unchanged. Verification MUST use the actual rendered template.

#### Scenario: PROXY-004-A Real rendered template forwards and sanitizes
- **GIVEN** the actual deployment template rendered with only synthetic domain/TLS/upstream settings
- **WHEN** nginx configuration validation and real HTTPS /api/auth/csrf requests run
- **THEN** requests reach the actual backend /auth/csrf route and return its CSRF JSON
- **AND** spoofed client headers cannot replace the edge's observed source
- **AND** frontend/nginx.conf bytes, type and mode are preserved

#### Scenario: PROXY-004-B Retained contracts and honest persistence limit
- **WHEN** the full source and release-image PostgreSQL/HTTPS acceptance runs
- **THEN** retained MFA/session/CLI/migration/wallet assertions pass without weaker quotas or authentication bypasses
- **AND** documentation states these 30/5/5 request limits remain process-local and restart persistence is not implemented by this change
