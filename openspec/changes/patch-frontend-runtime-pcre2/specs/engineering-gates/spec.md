## ADDED Requirements

### Requirement: IMG-PCRE2-001 Fixed frontend runtime PCRE2 without image-gate bypass

The frontend release image SHALL retain its immutable Alpine 3.24 Nginx base digest and install exactly `pcre2=10.49-r0` from the same v3.24 package branch. The existing image security gate MUST continue to reject any high or critical finding. No scanner exception, alternate repository, mutable image tag or release export on failed image verification is allowed.

#### Scenario: IMG-PCRE2-001-A Actual vulnerable image blocks export
- **GIVEN** the PR #29 built frontend image contains Alpine 3.24.2 and `pcre2` 10.48-r0
- **WHEN** Trivy reports HIGH CVE-2026-103111 with fixed version 10.49-r0
- **THEN** the frontend image security gate fails and candidate export remains unavailable, regardless of passing acceptance cases.

#### Scenario: IMG-PCRE2-001-B Fixed package in rebuilt candidate
- **GIVEN** the unchanged pinned Nginx runtime base and Alpine v3.24 main x86_64 package repository
- **WHEN** the frontend image is rebuilt from this change
- **THEN** the final runtime image contains `pcre2` exactly 10.49-r0 and retains the same application and Nginx configuration
- **AND** the exact rebuilt frontend image passes the existing high/critical scanner gate before any candidate export.

#### Scenario: IMG-PCRE2-001-C Patch unavailable or scan still failing
- **GIVEN** the exact package pin cannot be resolved, or the rebuilt image has any high or critical finding
- **WHEN** the image build and scan gates run
- **THEN** build or scan fails closed and no candidate export, promotion or deployment is claimed from that source.
