# Verification record — record-asset-swaps (in progress)

## Baseline and design review

- Root inspected AGENTS, target brief, continuity, actual Git diff, canonical specs,
  OpenSpec1.2.0 help/list/config and existing CI/CD. Base70d33bb; only owner Nginx edit.
- Retain exact connected FIFO/revision/immutable-command infrastructure; extend source
  unions/replay and typed consumers; do not replace pipeline or remove data/folders.
- Actual baseline command: `pnpm --dir backend test --runInBand --coverage=false
  asset-reward fifo historical-accounting trade-input csv owned-transfer-input
  historical-valuation manual-portfolio-valuation valuation-history`.
  Exit0,385tests/16suites,2.892s; `/private/tmp/capital-swaps-baseline.log`.
- Sol independent architecture/oracle review identified older incoming-asset lots as a
  fee-provenance hazard. Contract now explicitly separates held-before-acquisition versus
  incoming-original-prefix fees. Sol confirmed conservation and exact independent45/49.9
  results; Luna separately reviewed existing UI/retry surfaces and two critical journeys.
- Full before-product contract committed e83fe0c; isolated worktrees swap-core (Sol) and
  swap-contract (Luna). Root owns migration/dependencies/deployment/Docker integration.

## Execution

Actual preproduct pure RED: Sol test-only a17c399, ten cases all failed behaviorally
against the existing projector (ignored swaps/absent acquired inventory), no missing-module
or TypeScript failure. `/private/tmp/capital-swap-pure-red.log`. Root reviewed exact
oracles and requested stronger correct nested-provenance/full allocation expectations
before product implementation; those shape corrections do not change financial results.
Amended94b5b1b integrated asdf0fd17:10/10behavioral RED repeated,
`/private/tmp/capital-swap-pure-red-amended.log`, tsc/Biome passed. Root reviewed corrected
allocation ordering/nested provenance. Delta reviews64ae4c9/4da2913 integrated0cf55f2/e8a46e8;
source-basis versus consideration restatement clarified,15200original-origin bound and
swap-origin UI explicit. Root strict change validation passed after integration.

Actual preproduct HTTPS RED: `caffeinate -is node /private/tmp/capital-swaps-red.cjs`,
exit1. Fresh schema21 migration/seed, artifact checks, real password/MFA and two real
backend replicas/PostgreSQL succeeded. `SWAP-API` validPOST expected201 received404;
`SWAP-UI` failed because the `Обмены активов` region is absent. Exactly2cases,1Chromium
worker,0retries. `/private/tmp/capital-swaps-https-red.log`, traces/screenshots in
`/private/tmp/capital-swaps-red-artifacts`. All synthetic labeled containers/networks
were removed; no production/data/provider mutation. Tested predecessor images:

- BE `sha256:176f668b0c6a77e78961600a3b989446f2bd479a8bcbd9a933142b8e5684d25f`
- FE `sha256:fe42b103d5daf60de1ad13c2415defbbf0f948e5398ef37e627763e489a7069e`

Strict noUnused E2E TypeScript and scoped Biome pass for the new HTTPS tests. Owner
Nginx SHA256115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432 and
lock SHA2566a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d unchanged.

GREEN, postimplementation review and runtime gates have not run. The change is not
complete or ready to archive. See tasks.md for required/unrun scope.
