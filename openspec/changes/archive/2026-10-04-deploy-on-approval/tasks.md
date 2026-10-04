## 1. Acceptance tests first

- [x] 1.1 RAP-001/ENG-002: CD workflow gate tests for the workflow_run trigger, job condition, `release` mode and installation choices, step order and version 2 requests (`backend/src/engineering/gates.spec.ts`, `release-approval.spec.ts`).
- [x] 1.2 RAP-002: dispatcher request and flow tests for version 2 with embedded receipts (`tests/security/manual_mvp_dispatcher_test.py`, `manual_mvp_dispatch_flow_test.py`).
- [x] 1.3 RAP-003: runner orchestration tests for `resume-activation` success and refusals, and the `existing` refusal message (`backend/src/engineering/manual-mvp-orchestration.spec.ts`).
- [x] 1.4 RAP-004: Compose frontend health check test (`backend/src/engineering/release-approval.spec.ts`).
- [x] 1.5 RAP-005: installer `update` tests (`tests/security/manual_mvp_installer_test.py`).
- [x] 1.6 Record the expected failures (RED) in `verification.md`.

## 2. Implementation

- [x] 2.1 `cd.yml`: workflow_run trigger, guarded job condition, job-level mode/run/installation, `release` steps and version 2 requests.
- [x] 2.2 Dispatcher version 2 requests and `resume-activation` installation.
- [x] 2.3 Runner `resume-activation` and the `existing` refusal message.
- [x] 2.4 Compose frontend health check on `127.0.0.1`.
- [x] 2.5 Installer `update`.
- [x] 2.6 Release documentation and continuity.

## 3. Verification

- [x] 3.1 Focused suites, security tests, engineering gates, lint, builds and strict spec validation GREEN; record results.
- [x] 3.2 Hosted CI green on the PR. (PR run 37218242193; main run 37225929714.)
- [x] 3.3 After merge: owner runs `update` on the server, sets the required reviewer, and the first approved `release` with `resume-activation` succeeds. Archive only after that evidence or record why not. (Done 2026-10-04 with `existing`: `resume-activation` was refused because the activation had already completed; see verification.)
