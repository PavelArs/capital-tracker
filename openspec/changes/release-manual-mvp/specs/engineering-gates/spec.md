## MODIFIED Requirements

### Requirement: ENG-002 Controlled legacy deployment entry
Deployment SHALL have no push trigger and SHALL require manual dispatch. Image promotion, receipt generation, preflight and deployment SHALL require the main branch; outside main only read-only inventory of one owner-pinned release commit is permitted. The workflow SHALL reach the server only through the restricted data-only release dispatcher (MVP-007) and SHALL NOT use the shared Docker-capable deployment key, upload files or execute a remote shell. Failed-update recovery is performed server-side under MVP-004 rather than by a workflow rollback job. This containment MUST NOT be described as sufficient production readiness.

#### Scenario: ENG-002-A Automatic or unapproved rollout is unavailable
- **GIVEN** the manual MVP CD workflow
- **WHEN** the workflow entry conditions are evaluated
- **THEN** push cannot trigger deployment and only inventory of the pinned release commit can run outside main
- **AND** promotion, preflight and deployment require validated successful candidate provenance for the exact main commit

#### Scenario: ENG-002-B Deployment cannot use a general server shell
- **WHEN** the workflow contacts the server
- **THEN** it sends only a generated version/operation/commit/run request to the restricted dispatcher principal
- **AND** image promotion produces a receipt artifact that takes effect only after owner approval on the server
