## MODIFIED Requirements

### Requirement: ENG-002 Controlled legacy deployment entry
Deployment SHALL have no push trigger. It SHALL start only by manual dispatch or by
`workflow_run` after a successful `CI` run for a push to main, and every run SHALL use
the `production` environment so its protection rules (the owner's required reviewer)
gate the job before any credential is available. Image promotion, receipt generation,
preflight and deployment SHALL require the main branch; outside main only read-only
inventory of one owner-pinned release commit is permitted. The workflow SHALL reach
the server only through the restricted data-only release dispatcher (MVP-007) and
SHALL NOT use the shared Docker-capable deployment key, upload files or execute a
remote shell. Failed-update recovery is performed server-side under MVP-004 rather
than by a workflow rollback job. This containment MUST NOT be described as sufficient
production readiness.

#### Scenario: ENG-002-A Automatic or unapproved rollout is unavailable
- **GIVEN** the manual MVP CD workflow
- **WHEN** the workflow entry conditions are evaluated
- **THEN** push cannot trigger deployment, a CI run that failed or ran for a pull request or another branch cannot start it, and only inventory of the pinned release commit can run outside main
- **AND** every run waits for the `production` environment, and promotion, preflight and deployment require validated successful candidate provenance for the exact main commit

#### Scenario: ENG-002-B Deployment cannot use a general server shell
- **WHEN** the workflow contacts the server
- **THEN** it sends only a generated request with version, operation, commit, run id and, for version 2, the receipt promoted in the same job, to the restricted dispatcher principal
- **AND** the request carries no command, path, file content, environment or image other than the receipt's validated digests
