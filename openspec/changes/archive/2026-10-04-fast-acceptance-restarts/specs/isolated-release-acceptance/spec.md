## ADDED Requirements

### Requirement: ISO-006 Acceptance restarts skip the ignored stop signal
The isolated acceptance harness SHALL restart its backend containers with a zero stop
timeout, because the backend process ignores SIGTERM as PID 1 and a default restart
only delays the same forced stop. Every restart SHALL still wait for a new healthy
container start and HTTPS readiness before the case continues.

#### Scenario: ISO-006-A Restart without the stop grace period
- **GIVEN** a browser case that restarts the backend pair
- **WHEN** the harness issues the Compose restart
- **THEN** the restart uses a zero stop timeout
- **AND** the case continues only after both backends report a new healthy start and HTTPS readiness
