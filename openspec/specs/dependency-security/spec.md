# dependency-security Specification

## Purpose
Require reproducible production dependency audits, compatible remediation and honest verification of remaining findings.
## Requirements
### Requirement: DEP-001 Fail-closed production dependency audit
The repository SHALL provide a reusable production dependency audit using pinned
pnpm and a high/critical failure threshold. CI MUST require its exact successful
result and MUST NOT suppress advisory or registry failures.

#### Scenario: DEP-001-A Known high findings prevent success
- **GIVEN** the production graph contains a high or critical registry advisory
- **WHEN** the production audit and CI aggregate run
- **THEN** the audit exits nonzero and its required gate cannot pass
- **AND** no advisory identifier or registry error is ignored

#### Scenario: DEP-001-B Audit is missing or unavailable
- **GIVEN** the audit fails, is skipped/cancelled, lacks a result, or cannot obtain valid registry results
- **WHEN** the required CI aggregate evaluates the run
- **THEN** the aggregate exits nonzero and identifies dependency-audit

#### Scenario: DEP-001-C Reviewed graph has no high or critical findings
- **GIVEN** a frozen install of the reviewed lockfile
- **WHEN** the production audit completes with no high/critical findings
- **THEN** the audit exits successfully
- **AND** any lower-severity findings remain visible in the dated evidence

### Requirement: DEP-002 Compatible remediation preserves characterized behavior
Dependency remediation SHALL preserve the existing authentication, migration,
ownership and wallet contracts. Verification MUST use frozen dependencies and
the actual release images through HTTPS and PostgreSQL.

#### Scenario: DEP-002-A Retained source and real application acceptance
- **WHEN** the reviewed compatible dependency updates are installed and images built
- **THEN** existing source, migration, CLI, MFA/session and 55 browser acceptance cases pass without weaker security or financial assertions
- **AND** owner configuration and all non-synthetic data remain untouched

#### Scenario: DEP-002-B External fixtures retain verified HTTPS transport
- **GIVEN** the actual updated HTTP client uses HTTPS CONNECT through the isolated fixture proxy
- **WHEN** it requests an allowlisted external provider
- **THEN** normal TLS verification succeeds using only the mounted public synthetic certificate and the expected fixture response is recorded
- **AND** untrusted certificates, mismatched CONNECT/SNI/Host identities, unknown authorities and tunneled control requests are rejected without live upstream traffic
- **AND** fixture keys and trust settings stay outside production images and configuration

### Requirement: DEP-003 Bounded honest security evidence
Dependency evidence SHALL identify the date, tools, dependency graph, advisory
scope, changes and remaining findings. It MUST distinguish audit results from
exploitability assessment, other scanners, hosted CI and production readiness.

#### Scenario: DEP-003-A Results and remaining scope are reviewable
- **WHEN** the change is verified
- **THEN** the report records actual command exits, lock checksum, image IDs and retained test results
- **AND** unresolved findings have explicit status and follow-up with no fabricated passing checks
