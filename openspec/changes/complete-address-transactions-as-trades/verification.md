# Address transaction completion verification

Status: implemented; local checks below passed; hosted critical acceptance (Playwright
through HTTPS, backend and PostgreSQL) pending on the draft PR. The change stays active
until that run is green.

Baseline: main `f63be8c`. Branch `claude/address-import-b32kzd`.
Environment: cloud container, Node 22, pnpm 10.33.0, PostgreSQL 16 (local throwaway
cluster). Docker image builds are blocked here by the sandbox TLS proxy, so
`pnpm test:e2e` / `test:e2e:critical` cannot run locally.

## Risk-based check manifest

| Scenarios | Check | Where |
| --- | --- | --- |
| ADDRT-COMPLETE, REPLAY, INVALID, ATOMIC, STATE, PRIVATE (service), MIGRATION | `tests/e2e/wallet-address-trades-db.cjs`: real PostgreSQL, real migration CLI, real `TradeService` | local, hosted CI |
| ADDRT-INVALID input shape | `wallet-address-input.spec.ts` | local |
| ADDRT-MIGRATION preservation | `tests/e2e/migrations.cjs` (fresh 24, populated 16/18/21 -> 24 preservation and replay) and the count bumps in every `*-db.cjs` probe | local (migrations, auth-limits), hosted CI |
| ADDR-4 (modified) | `tests/e2e/wallet-addresses-db.cjs` exact item shape now includes `trade: null` | local, hosted CI |
| ADDRT-UI, ADDRT-PRIVATE (HTTP 401/403) | `tests/e2e/wallet-address-trades.spec.ts`, added to the critical manifest (22 cases) | hosted CI only |
| UI rendering | `WalletAddresses.test.tsx` | local |

## RED before behavior

The completion service was a stub throwing 501 (`NotImplementedException`); the route
and migration were present.

- PG probe: migration applied (24), then failed at ADDRT-INVALID: `Expected HTTP 422,
  got 501`.
- Vitest: ADDRT-UI 2 of 2 written at that point failed (no «Дополнить» button in the incoming row; voided row
  lacked «Сделка отменена»); the 3 ADDR-UI tests still passed.

## GREEN (local)

- `tests/e2e/wallet-address-trades-db.cjs`: all ADDRT scenarios PASS.
- `tests/e2e/wallet-addresses-db.cjs`: PASS (with the `trade: null` shape).
- `tests/e2e/migrations.cjs`: PASS (populated 16, 18 and 21 to 24).
- `tests/e2e/auth-limits-db.cjs`: PASS.
- `pnpm --dir backend test --runInBand`: 62 suites, 1628 tests passed.
- `pnpm --dir frontend test`: 27 files, 139 tests passed.
- `pnpm --dir backend lint`, `pnpm --dir frontend lint`: exit 0, only pre-existing
  warnings in files this change does not touch.
- `pnpm --dir backend build`, `pnpm --dir frontend build`: pass.
- `node scripts/critical-release-profile.test.cjs`: pass (22 cases).
- `openspec validate complete-address-transactions-as-trades --strict`: valid.

Not run locally:
- `tests/e2e/client-source-startup.cjs` needs the backend container's MFA key and
  environment; only its migration count and latest name changed. Hosted CI runs it.
- `tests/e2e/usd-trades-db.cjs` fails at TRADE-006-B (expected constraint name on a
  `manual_accounts` delete) on local PostgreSQL 16 both with this change and on main
  `f63be8c` built in a separate worktree, so it is an environment difference (CI uses
  PostgreSQL 18). All earlier stages, which exercise the trade write path this change
  hooks into, pass.

## Independent review

A separate reviewer read the diff and found no owner-isolation leak, non-additive schema
change or status-ordering problem. Findings and what changed:

- Save could silently do nothing while the account's journal state was still loading
  (a likely Playwright flake). Fixed: saving waits for the read; page test added.
- A completion voided in the journal could never be redone, so a purchase recorded in
  the wrong account was stuck. Fixed: the link's primary key is now the trade
  reference with an index on the transaction; the service refuses a new completion
  only while a linked trade is active (checked under the owner's accounting lock,
  which voids also take). ADDRT-STATE and the probe now cover void then redo.
- A retry after a lost response used a new request id and got 409. Fixed: the form
  keeps its request id while account, revision and fields are unchanged; page test.
- The ADDR-UI page test assertion had been loosened unnecessarily; the exact
  `toBe('не указана')` is restored.
- A failed account/instrument load was silent; the form now says so.
- The default account now comes from the latest active completion.
- Not changed, recorded as known limits in design: a later journal correction is
  shown as is (the owner's own edit); the instrument is not forced to be BTC, the form
  preselects the BTC instrument; after saving, the first page of transactions is
  reloaded.

## Hosted CI

Pending on the draft PR.
