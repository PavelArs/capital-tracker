## 1. Acceptance tests first

- [x] 1.1 ENG-006: release job condition and aggregate behaviour per event (`backend/src/engineering/gates.spec.ts`).
- [x] 1.2 Record the expected failures (RED) in `verification.md`.

## 2. Implementation

- [x] 2.1 `ci.yml`: run the release job on push only; aggregate omits it only for pull requests.
- [x] 2.2 Testing documentation and continuity.

## 3. Verification

- [x] 3.1 Backend tests, engineering and security gates, lint and strict spec validation GREEN; record results.
- [x] 3.2 Hosted CI on the PR green with the release job skipped (run 37225591208).
- [x] 3.3 First main run after merge runs the release job and passes; then archive. (Main run 37225929714 ran the release job on the push and passed.)
