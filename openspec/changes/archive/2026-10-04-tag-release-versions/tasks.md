## 1. Acceptance tests first

- [x] 1.1 RVR-001: version naming step and image version tags in promotion (`backend/src/engineering/release-versions.spec.ts`).
- [x] 1.2 RVR-002: deployed-version output and the separate tag job (`release-versions.spec.ts`, job lists in `gates.spec.ts` and `release-approval.spec.ts`).
- [x] 1.3 Record the expected failures (RED) in `verification.md`.

## 2. Implementation

- [x] 2.1 `cd.yml`: name the version, push image version tags, report the deployed version, add the `tag` job.
- [x] 2.2 Release documentation and continuity.

## 3. Verification

- [x] 3.1 Engineering gates, backend tests, lint and strict spec validation GREEN; record results.
- [x] 3.2 Hosted CI green on the PR. (PR run 37219632689; main run 37225929714.)
- [x] 3.3 After merge: the first approved release pushes the version image tags and creates the Git tag. Archive only after that evidence or record why not. (Deploy run 37227344833 pushed `v2026.10.04-3bdceea` image tags and created the Git tag.)
