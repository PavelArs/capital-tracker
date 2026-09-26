## 1. Contract and expected failure

- [x] 1.1 Review the exact swap/fee/evidence convention and all affected capability deltas; strict OpenSpec validation passes with preservation inventory and baseline recorded.
- [x] 1.2 Write independent SWAP-001/002/003/004 pure acceptance and SWAP-API/UI tests before implementation; demonstrate behavioral RED on the predecessor, recording actual assertions and images.

## 2. Exact domain and input

- [x] 2.1 Implement swap FIFO/provenance/fee-source logic and independent completeness; pass pure oracles including old-target lots, tiny intervals, transfers and retained characterization.
- [x] 2.2 Implement strict complete command/query parsing and canonical replay payloads; test malformed fields, normalization, limits, fee coupling, null/zero and immutable target pins.

## 3. Private connected persistence

- [x] 3.1 Add migration22 and real PG acceptance for fresh/populated21 preservation, SQL constraints and deferred COMMIT rollback; preserve previous schemas and data.
- [ ] 3.2 Implement owner-scoped immutable API/store/service and connected loading/replay for every trade/reward/transfer/CSV mutation and historical reader; verify exact replay, CAS and two-process races.
- [ ] 3.3 Verify account/owner/component/version/passive-revision bounds, pinned complete allocation pages, real two-connection coherent snapshots and once-only series/portfolio loads.

## 4. Russian owner workflow

- [x] 4.1 Update existing typed/rendered consumers for swap origins and dedicated results without altering actual USD-trade totals; verify historical/value/CSV regressions and honest unknown evidence.
- [x] 4.2 Implement reviewed create/correct/void UI with explicit fee source and frozen ambiguous retry across SPA remount; preserve separate trade draft and reject stale/late reviews.

## 5. Review and delivery evidence

- [ ] 5.1 Independently review contract, finance, transaction/security boundaries, UI recovery and test oracles; fix findings and retain review evidence.
- [ ] 5.2 Run risk-based manifest below against actual release images; record successful/failed attempts, exact scenarios/images, unrun gates, warnings and protected-file hashes. Update runner/owner guide/continuity.
- [ ] 5.3 After all required gates pass, synchronize/archive using supported OpenSpec CLI; compare delta blocks and untouched specs, verify canonical strict validation and synthetic cleanup, then mark this final procedural task complete.

## Verification manifest

- Pure Jest `asset-swap` plus affected `fifo`, `asset-reward`, `trade-input`, `csv`,
  `historical-accounting`, `historical-valuation`, `manual-portfolio-valuation`,
  `valuation-history`, `owned-transfer-input`: SWAP-001/002/003/004 exact calculations,
  unknown evidence, bounds and compatible predecessor DTOs. No repository/auth mocks.
- Real PG `asset-swaps-db.cjs`: SWAP-001..004/006 economics, lifecycle, additive migration,
  owner boundaries, actual SQL constraints/COMMIT rollback, snapshot coherence and CSV.
- Real PG `migrations.cjs --from21`: SWAP-006 fresh22/populated21/no-op/downgrade refusal;
  native predecessor fixtures preserve every previous schema/row plus actual encrypted
  MFA, sessions, CSV bytes/receipts, rewards, transfers, manual prices and display FX.
- Real PG `asset-swaps-bounds-db.cjs`: SWAP-003-B/004-B processes/advisory locks/CAS,
  active/version/passive revision limits and paged complete materialization.
- Selected retained PG transfer/reward fixtures where connected loader behavior changes.
  Update hardcoded fresh-schema fixture expectations deliberately; preserve populated
  predecessor construction. Record exact selected predecessor upgrades; don't claim others.
- Real HTTPS Playwright exactly two new cases `SWAP-API` and `SWAP-UI` plus retained
  rewardUI, transferUI and historical valuationUI: SWAP-001..006 public critical journey,
  actual password/MFA, PG, Origin/CSRF, generic errors, immutable retry and no provider use.
  One Chromium worker, zero retries. Only external services stubbed; route.fetch may delay
  or abort a real response. Add stale-response case within the UI journey, not a new suite.
- Package builds/lints, frontend unit tests, changed-file formatting, strict E2E TypeScript,
  strict OpenSpec validation, production dependency audit (no high/critical or hidden errors).
- Unrun by default: full historical E2E matrix, full unrelated backend suites, hostedCI,
  whole ASVS/scanners/backup-restore/release/production. Separate release work remains.
