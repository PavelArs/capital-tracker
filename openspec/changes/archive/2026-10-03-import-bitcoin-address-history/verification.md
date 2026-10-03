# Bitcoin address import verification

Status: implemented; local checks below passed; independent review recorded below;
hosted critical acceptance (Playwright through HTTPS, backend and PostgreSQL) pending
on the draft PR. The change stays active until that run is green.

Baseline: main `4a52f9f`. Branch `claude/address-import-b32kzd`.
Environment: cloud container, Node 22.22.0, pnpm 10.33.0, PostgreSQL 16.14 (local
throwaway cluster). Docker image builds are blocked here by the sandbox TLS proxy, so
`pnpm test:e2e` / `test:e2e:critical` cannot run locally.

## Risk-based check manifest

| Scenarios | Check | Where |
| --- | --- | --- |
| ADDR-ADD | `bitcoin-address.spec.ts` (BIP-173/350 and base58check vectors, mixed case, testnet, typos) and PG probe | local |
| ADDR-AMOUNTS, ADDR-SYNC-INVALID, provider failures | `esplora-client.spec.ts` against a real local HTTP server (no axios mock) | local |
| ADDR-SYNC-PAGES/REPLAY/INCREMENTAL/RESUME/INVALID, ADDR-DB, ADDR-PRIVATE (service) | `tests/e2e/wallet-addresses-db.cjs`: real PostgreSQL, real migration CLI, requests through `HTTPS_PROXY` to `tests/e2e/providers.cjs` | local (stub run outside Docker), hosted CI |
| ADDR-MIGRATION | `tests/e2e/migrations.cjs` (fresh, legacy refusal, populated 11..21 -> 23 preservation and replay) and the probe's down refusal | local, hosted CI |
| ADDR-UI, ADDR-PRIVATE (HTTP) | `tests/e2e/wallet-addresses.spec.ts`, added to the critical manifest (21 cases) | hosted CI only |
| UI rendering | `WalletAddresses.test.tsx` | local |

## RED before behavior (commit 22f6fbb)

Stubs had the routes, migration and signatures but no behavior.

- Jest: 39 failed, 5 passed of 44. Failures are assertion failures, e.g. expected
  `bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4`, received the upper-case input;
  `Expected constructor: BadRequestException / Received function did not throw`; adapter
  results `{ ok: true, transactions: [] }` instead of the expected requests and outcomes.
  The 5 passes were base58 inputs the identity stub happened to return unchanged.
- Vitest: 3 of 3 failed (`Unable to find an element with the text: Адресов пока нет.`).
- PG probe: migrations applied 23 then failed at ADDR-ADD with
  `AssertionError: Missing expected rejection` (mixed-case address accepted).
- One test-authoring fix after RED: the BIP-173 P2WSH vector I wrote from memory had a
  bad checksum (the verified P2WPKH and BIP-350 vectors pass); it was replaced by a
  32-byte program encoded with the verified algorithm and labelled as such.

## GREEN (commit e88c370, then review fixes)

| Command | Result |
| --- | --- |
| `pnpm --dir backend exec jest wallet-addresses` | 48 passed |
| `pnpm --dir backend test --runInBand` | 60 suites, 1612 tests passed (baseline 1564) |
| `pnpm --dir frontend test` | 26 files, 132 tests passed (baseline 129) |
| `pnpm lint` | 0 errors; existing 77 backend / 27 frontend warnings unchanged |
| `pnpm build` | passed (existing >500 kB chunk warning) |
| `pnpm specs:validate` | 49/49 |
| `node --test scripts/critical-release-profile.test.cjs scripts/csv-import-admission-oracle.test.mjs` | 10/10 (manifest 21 cases) |
| `pnpm test:security` | 80 tests OK, 3 skipped |
| `wallet-addresses-db.cjs` | 11/11 PASS, repeated twice after the review fixes (9/9 three times before) |
| `migrations.cjs` | all PASS, populated 11..21 -> 23 |
| `manual-usd-prices-db`, `owned-transfers-db`, `asset-rewards-db`, `period-profit-db` (count bumps, predecessor exclusions) | PASS |
| `asset-swaps-db` | FAILS at `SWAP-006 referenced head cannot disappear` (expects SQLSTATE 23001). Unchanged `main` fails identically on this PostgreSQL 16 cluster, so it is an environment difference (CI uses the pinned PostgreSQL 18 image), not this change. |

Not run here: Playwright E2E (ADDR-UI and the other 20 critical cases), the other
PostgreSQL probes whose only edit is the 22 -> 23 count, image scans. A live
blockstream.info request was not possible (the sandbox proxy denies it); the adapter
follows the documented Esplora schema and is exercised only against fixtures.

## Independent review

A separate reviewer context read the full diff. Findings and outcome:

- Major, fixed: real Esplora answers `200 []` for a cursor a lagging backend does not
  know, and the sync took that as the end of history, leaving a permanent gap. The stub
  answered 422 instead, which hid it. Now the stub mirrors electrs (`200 []`), has an
  `empty` fault, and an empty page after a cursor ends the walk only when
  `chain_stats.tx_count` agrees (design.md). New probe scenarios ADDR-SYNC-END and
  ADDR-SYNC-LIMIT; RED observed first: the probe failed at ADDR-SYNC-END because no
  transaction-count request was made.
- Minor, fixed: empty top page no longer clears the completed anchor; total response
  deadline via abort signal (test fails without it: 5 s instead of < 1 s); body cap
  32 MB; `self` only when the address did not gain; frontend no longer double-reads,
  dedupes "Показать ещё" rows, clears read errors and keeps a re-added card in place.
- While adding ADDR-SYNC-END, the stub's counterparty address turned out to equal one
  imported test address; the stub now uses a counterparty no test imports.
- Accepted as is: no service-level Jest test (the state machine is tested against real
  PostgreSQL only); pacing is per client instance, not global; offset paging rather than
  keyset (duplicates are filtered in the UI); `PAGE_SIZE` fixed at 25 for blockstream.info.

## Hosted CI

- Run 37146422170 on head `8fad5e6`, job "Release Images and Security": the migrate-container
  PostgreSQL probes (including `wallet-addresses-db.cjs`, `auth-limits-db.cjs` and
  `migrations.cjs` with 23 migrations) passed, critical real release acceptance passed
  21 of 21 cases including `ADDR-UI / ADDR-PRIVATE`, and the critical acceptance receipt
  verified for that SHA and run.
- The same job then failed at the exact-image security gate on the nginx base image's
  pcre2 package. That failure is not this change's: it fails on `main` too, and the
  one-line `frontend/Dockerfile` fix lives in the `show-unrealized-pnl` branch (PR #30).
- Earlier runs on this branch failed first on two probes still pinned to 22 migrations,
  then on `ADDR-UI` counting provider requests left by the earlier database probes; both
  were test fixes, recorded in commits `95b25da` and `8fad5e6`.
