## 1. Acceptance tests first

- [x] 1.1 ENG-001/004/005/006/007: workflow job graph, shard steps, final merge and CD provenance tests (`backend/src/engineering/gates.spec.ts`).
- [x] 1.2 ENG-007: shard plan, probe split, browser split, shard receipts and merge tests (`scripts/acceptance-shards.test.cjs`, `scripts/critical-release-profile.test.cjs`).
- [x] 1.3 Record the expected failures (RED) in `verification.md`.

## 2. Implementation

- [x] 2.1 `critical-release-profile.cjs`: `partition`, `project`, `merge`; `receipt` and `verify` unchanged.
- [x] 2.2 `acceptance-shards.cjs`: canonical checks, shard plans, image verification, shard receipts, merge CLI.
- [x] 2.3 `acceptance.mjs`: `images` and `critical --shard` modes on the shared plan; `run`, `critical`, `down` unchanged.
- [x] 2.4 `ci.yml`: build job, shard matrix, final merge job, `workflow_dispatch`, aggregate; `cd.yml` provenance.
- [x] 2.5 Testing documentation and continuity.

## 3. Verification

- [x] 3.1 Backend, engineering and security tests, lint, types, Biome, YAML and strict spec validation; record results.
- [x] 3.2 A hosted run (manual dispatch or main push) passes all shards and the final job; record its wall times and artifact size. (Dispatch run 37227886949: whole CI 11 min 51 s.)
- [ ] 3.3 The next approved release validates the new provenance; then archive.
