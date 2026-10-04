## MODIFIED Requirements

### Requirement: RAP-001 Approved release after green main CI
The CD workflow SHALL run a `release` mode when `CI` completes successfully for a push
to main, using that CI run id, the `existing` installation and the current main commit.
`release` SHALL validate candidate provenance exactly as promotion does, promote the
tested images, write the receipt, then send a preflight request and, only if it
succeeds, a deploy request, all in one job in the `production` environment. Manual
dispatch SHALL offer `release` with an explicit installation choice next to the
existing modes. A run whose CI commit is no longer the main head SHALL refuse; an automatic run for
such a CI run SHALL be skipped before it asks for the environment approval.

#### Scenario: RAP-001-A Green main CI starts an approval-gated release
- **GIVEN** `CI` completed with conclusion success for a push to main
- **WHEN** the workflow_run event is evaluated
- **THEN** the deploy job runs in the `production` environment with mode `release`, the CI run id from the event and installation `existing`
- **AND** promotion, receipt writing, preflight and deploy run in that order, deploy only after preflight succeeds

#### Scenario: RAP-001-B Other CI outcomes cannot release
- **WHEN** CI failed or was cancelled, ran for a pull request, or ran for another branch
- **THEN** the deploy job does not run

#### Scenario: RAP-001-C Manual release keeps an explicit installation
- **WHEN** the owner dispatches the workflow manually
- **THEN** the modes are `release`, `inventory`, `promote`, `preflight` and `deploy`
- **AND** the installation choices are `existing`, `fresh`, `resume-fresh` and `resume-activation`

#### Scenario: RAP-001-D An obsolete green CI run does not ask for approval
- **GIVEN** `CI` completed successfully for a push to main whose commit is no longer the main head
- **WHEN** the workflow_run event is evaluated
- **THEN** the deploy job is skipped and no `production` approval is requested
- **AND** the CI run of the current main head still starts its own approval-gated release
