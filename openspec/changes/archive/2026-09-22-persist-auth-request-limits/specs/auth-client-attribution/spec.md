## MODIFIED Requirements

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
- **AND** documentation distinguishes shared PostgreSQL authentication admission from the unchanged process-local general-route quotas
