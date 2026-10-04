## 1. Acceptance tests first

- [x] 1.1 ISO-006-A: engineering test that every acceptance Compose restart uses a zero stop timeout (`backend/src/engineering/acceptance-restarts.spec.ts`).
- [x] 1.2 Record the expected failure (RED) in `verification.md`.

## 2. Implementation

- [x] 2.1 `tests/e2e/replicas.ts`: restart the backend pair with `--timeout 0`.
- [x] 2.2 Continuity note.

## 3. Verification

- [x] 3.1 Backend tests, engineering gates, lint and strict spec validation GREEN; record results.
- [x] 3.2 Hosted CI green on the PR with a shorter critical acceptance step (run 37224977589: 18 min 03 s, was 29 min 21 s).
- [x] 3.3 Archive after merge (PR #44 merged 2026-10-04).
