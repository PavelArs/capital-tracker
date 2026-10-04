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

## Not run

- Any Docker, PostgreSQL, provider, HTTPS or browser execution; the image build, save,
  load and ID equality after `docker load`; the Trivy scans; candidate export.
- A hosted CI run (manual dispatch or main push), its wall times and the image artifact
  size; CD provenance against a real sharded run.
