## 1. Acceptance tests first

- [x] 1.1 RAP-001-D and the exact deploy condition in `release-approval.spec.ts` and `gates.spec.ts`.
- [x] 1.2 Record the expected failures (RED) in `verification.md`.

## 2. Implementation

- [x] 2.1 `cd.yml`: require the CI commit to be the current main head for automatic runs.
- [x] 2.2 Release documentation and continuity.

## 3. Verification

- [x] 3.1 Engineering gates and strict spec validation GREEN; record results.
- [ ] 3.2 Hosted CI green on the PR.
- [ ] 3.3 After merge: the next main CI starts exactly one deploy run; then archive.
