# Verification: parallel-release-acceptance

All checks ran in the cloud sandbox on 2026-10-04 on top of main `3bdceea` (after
`e2e-on-main-only`), Node 22.22.0, pnpm 10.33.0, OpenSpec telemetry off. Docker and
browsers are not available there: no acceptance, image build, scan or hosted run was
executed for this change.

## RED (tests written first, implementation unchanged)

- `jest src/engineering/gates.spec.ts`: 21 failed, 206 passed (227). Failing: ENG-006-A
  (no `workflow_dispatch`, release conditions), ENG-006-B for all four events (new
  release jobs not required), ENG-001-D (eleven-job aggregate, missing `release-images`
  and `critical-acceptance`), ENG-004 (three-job graph, conditions, aggregate output),
  ENG-005-A (shard acceptance step, report upload, pull step location), ENG-005-B
  (provenance with the merge step; serial step name still accepted), ENG-007-A..E (build
  job, artifact loading, matrix, final merge job, CD shard requirements, the full CD step
  on a push run). The CD refusal of non-push runs (`workflow_dispatch`, `pull_request`,
  `schedule`) already passed: the existing `.event=="push"` check holds.
- `node --test scripts/critical-release-profile.test.cjs scripts/acceptance-shards.test.cjs`:
  4 passed, 3 failed: `acceptance-shards.cjs` missing (prerequisite) and
  `profile.partition is not a function` in the partition and merge tests.

## GREEN

- `pnpm test:engineering`: Jest 245 passed (gates 227, preservation 18); Node 23 passed
  (critical profile 6, shards 11, CSV admission oracle 6).
- `pnpm --dir backend test --runInBand`: 63 suites, 1698 tests passed.
- `pnpm test:security`: 93 tests OK (3 skipped, as before).
- `node --test scripts/critical-release-profile.test.cjs`: 6 passed.
- `pnpm --dir backend lint`: 77 existing warnings, no errors.
  `pnpm --dir backend exec tsc --noEmit -p tsconfig.json`: clean.
- `pnpm --dir backend exec biome check` on `scripts/acceptance-shards.cjs`,
  `scripts/acceptance-shards.test.cjs`, `scripts/acceptance.mjs` and
  `src/engineering/gates.spec.ts`: clean. `scripts/critical-release-profile.cjs` and its
  test were already not Biome-formatted on main (and the test has an existing
  `noUnsafeFinally` lint error at its cleanup-failure fixture); the added code introduces
  no lint finding and those files were not reformatted to keep the reviewed diff small.
- Both workflows parse as YAML (rechecked after the concurrency-group and report
  `overwrite` edits, with engineering Jest 388/388 across all 12 suites); `git diff --check` clean; `frontend/nginx.conf`
  unchanged.
- `OPENSPEC_TELEMETRY=0 pnpm exec openspec validate --all --strict --no-interactive`:
  55/55.
- Mutation checks (reverted afterwards): dropping `browser-3` from the CD shard list,
  and exempting `workflow_dispatch` from the aggregate, each fail the gate tests.
- Argument refusals of `scripts/acceptance.mjs` without Docker: unknown command, unknown
  shard, missing or reordered `--shard/--images`, extra arguments to `run`/`down`, and
  prebuilt modes without a CI run id all exit before any Docker call; a missing image
  manifest fails before Docker.

## Dry run of the split

`node scripts/acceptance-shards.cjs plan` and a scratch script over the same module
(estimates from run 37220925062; unlisted probes about 8 s):

- `probes-1` (15 checks, about 270 s): restore-readiness, provider-proxy, migrations,
  auth-limits, manual-opening, usd-trades, csv-import, historical-accounting,
  external-usd-flows, period-profit, xirr-preview, twr-preview, linked-twr,
  manual-usd-prices, owned-transfers-bounds.
- `probes-2` (16 checks, about 273 s including migrate/seed): carry-in,
  historical-valuation, valuation-history, display-fx, manual-portfolio-valuation,
  owned-transfers, asset-rewards, asset-rewards-bounds, asset-swaps, asset-swaps-bounds,
  wallet-addresses, owner-cli, sessions, mfa-db, mfa-expiry, migrate, seed,
  client-source-startup.
- `browser-1`: MFA-002-A, SES-002-A, SWAP-UI, CSV-006-A, PRICE-UI, MPV-UI, TWR-UI.
  `browser-2`: MFA-002-B, OPEN-001-A, REWARD-UI, CSV-006-B, VAL-UI, PROFIT-UI, SHELL-UI.
  `browser-3`: SES-001-B, TRADE-003-A, TRANSFER-UI, FLOW-004-A, VCH-UI, XIRR-UI, ADDR-UI.
- Probe union equals the 31 canonical checks; case union equals the 21 manifest cases.
  The real Playwright CLI (`--list`) routes exactly 7 cases for each browser shard.

## Hosted CI (2026-10-04)

Manual dispatch run 37227886949 on `9d2e20d` (before `fast-acceptance-restarts`
landed, so browser restarts still waited 10 s each) passed all 16 jobs:

- Whole run 19:20:20–19:32:11, 11 min 51 s (the last main run with the serial job,
  37225929714, spent about 32 min in `Release Images and Security` alone).
- `Build Release Images` 1 min 11 s; `release-images` artifact 727 MB (four images,
  uncompressed), download 7–26 s per job, load and ID check 14–21 s.
- Acceptance step per shard: probes-1 2 min 08 s, probes-2 3 min 06 s, browser-1
  4 min 50 s, browser-2 5 min 56 s, browser-3 5 min 31 s.
- `Release Images and Security` 2 min 15 s: merge and receipt verification, four scans,
  candidate export (237 MB) unchanged.
- PR run on the same head skipped the three release jobs, as for any pull request.

## Not run

- CD provenance against a real sharded main run: the first approved release after
  merge (task 3.3).
