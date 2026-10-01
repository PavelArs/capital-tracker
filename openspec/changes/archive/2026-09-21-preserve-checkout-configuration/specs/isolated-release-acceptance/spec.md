## MODIFIED Requirements

### Requirement: ISO-005 Isolated reproducible artifacts
Release images SHALL install from the committed lockfile using pinned pnpm and
exclude tests, fixture scripts, synthetic credentials and test reset endpoints.
The harness SHALL expose only its loopback HTTPS proxy and deny live provider egress.
It SHALL preserve the checkout's existing Nginx file bytes, regular-file type and
permissions across the entire run, including cleanup and failure paths, without
requiring a particular machine's checksum.

#### Scenario: ISO-005-A Artifact and network inspection
- **GIVEN** images built from the repository and the isolated test stack
- **WHEN** final files, published ports and provider traffic are inspected
- **THEN** production files contain no test fixture/credential code
- **AND** PostgreSQL/Redis/backend ports are unpublished and outbound provider traffic reaches fixtures only
- **AND** the owner's existing Nginx file remains unchanged

#### Scenario: ISO-005-B Periodic jobs can be disabled without bypassing adapters
- **GIVEN** BACKGROUND_JOBS_ENABLED=false during isolated acceptance or maintenance
- **WHEN** the application starts
- **THEN** periodic cron jobs are not registered, while startup and explicit refresh still use real adapters
- **AND** periodic jobs remain enabled when the setting is omitted

#### Scenario: ISO-005-C Portable configuration preservation
- **GIVEN** a clean checkout or one with an existing local Nginx edit
- **WHEN** acceptance completes without changing that file
- **THEN** preservation succeeds for either starting content
- **AND** modification, truncation, removal, symlink replacement or permission changes fail without overwriting the file

#### Scenario: ISO-005-D Failure-path preservation
- **GIVEN** acceptance or cleanup throws an error
- **WHEN** control exits the protected action
- **THEN** file preservation is still checked and both errors are retained if both occurred
- **AND** a missing or symlink baseline fails before any acceptance side effect
