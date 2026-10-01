## ADDED Requirements

### Requirement: AXS-001 Reproducible Axios security remediation

The release dependency graph SHALL use exact Axios 1.20.0 in backend and frontend
with a committed frozen lockfile. The real production audit MUST reject any high
or critical advisory and preserve visible lower-severity findings. Remediation
evidence SHALL distinguish registry audit, retained characterization, actual HTTP
transport and release-image/browser verification without suppressing findings.

#### Scenario: AXS-001-A Vulnerable production graph blocks release
- **GIVEN** the actual production graph resolves vulnerable Axios 1.18.0
- **WHEN** the real registry-backed production audit runs
- **THEN** the gate exits nonzero for the reported high advisories
- **AND** the exact 1.20.0 upgrade is verified through official upstream metadata
  and a subsequent frozen-install registry audit, without advisory ignore entries

#### Scenario: AXS-001-B Retained transport and authentication characterize the upgrade
- **GIVEN** the reviewed Axios upgrade and retained explicit provider request options
- **WHEN** scoped real HTTP-adapter and release-image/provider checks run
- **THEN** timeouts, refusal to follow redirects, 429 Retry-After metadata and
  bounded response handling remain observable
- **AND** selected real HTTPS password/MFA/CSRF and stored-provider workflows pass
  on the rebuilt source without bypassing application authentication or persistence

#### Scenario: AXS-001-C Missing or failed registry verification cannot pass
- **GIVEN** an unavailable registry or any remaining dependency advisory
- **WHEN** verification evidence and release-gate results are evaluated
- **THEN** registry/network failure cannot be reported as a clean audit
- **AND** lower-severity findings remain visible even when the high/critical gate passes
