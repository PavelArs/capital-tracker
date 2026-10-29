# Code quality audit: duplication, dead code and maintainability

**Status:** Proposed
**Date:** 2026-10-29
**Source commit:** `eeb5b637` (main after PR #368)
**Companion to:** [ADR-001](https://github.com/PavelArs/capital-tracker/blob/eeb5b637/docs/architecture-audit.md) (`docs/architecture-audit.md`, merged in #368 and dropped from main by the #373 squash), which covers system-level patterns (caching, queues, backups, Redis, pacing, health checks). This audit is code-level and does not repeat ADR-001's findings.

## Context

The owner asked for a list of improvements that make the current code easier to maintain and new features easier to add: less duplication, fewer anti-patterns, less generated-looking sprawl. Seven read-only reviewers covered the codebase by area. Every finding they reported was then checked against the code by independent adversarial verifiers, whose job was to refute it. A completeness critic named the areas the first pass missed, and five more reviewers audited those. Tool output from knip, jscpd, Biome and a function-length scan fed the reviewers. The verification record at the end lists what ran and what did not.

IDs in this document (`A-01`, `G1-01`, …) are this audit's own numbers. They are not scenario IDs.

## Verdict

The code is careful where the rules in AGENTS.md matter most. Money stays in BigInt atoms and decimal strings, missing values stay missing, commands are idempotent, provider parsers are strict, and the client specs use real HTTP servers. No auth invariant was found broken.

The maintenance cost comes from growth by copying. Each new entry kind, chain, provider, page or probe was added by copying its nearest sibling, and the copies have started to drift. Exact clones are low (1.5% of `src/`), but the same shape recurs under different names. Examples are the read-only transaction idiom (29 sites), the wallet-leg insert (8 copies), the scheduled-job skeleton (5 copies), hand-rolled page loaders (about 20) and probe bootstrap code (10% clones across 54k lines of probes). The drift has produced real defects: two jobs share one lock key, a sync label is missing for 10 of 13 networks, an AssetPage request race, and doubled error toasts.

Most findings are P3 cleanups. Verifiers downgraded most P2 claims after checking. The recommended course is a short list of fixes now, followed by small, behaviour-preserving refactors done when a change already touches the area. No framework, generic base class or code generator is recommended: the copies differ enough that a large abstraction would cost more than it saves.

| Result | Count |
|---|---|
| Raw findings from the seven area reviews | 138 |
| Merged findings after removing overlaps | 121 |
| Findings from the five gap audits | 33 |
| Verified and kept (confirmed or partly confirmed) | 149 |
| Refuted | 5 |
| Final severity P1 / P2 / P3 | 3 / 11 / 135 |

## Fix first

These break a rule in AGENTS.md or produce wrong observable behaviour. Each fix is small, and each needs its failing test first.

| ID | Problem | Fix | Effort |
|---|---|---|---|
| A-01 | **P1.** Day filters use UTC days. Audit history filters on `AT TIME ZONE 'UTC'` (`backend/src/accounting/audit-history.service.ts:170`), while its page headings use the browser zone. A change at 21:30 UTC is listed under one day and filtered under another. Transactions filter on `occurredAt.slice(0, 10)` (`operation-list.ts:809`) and the frontend presets use a UTC "today" (`TransactionsPage.tsx:949`). | Fix audit history now: a RED case in `tests/e2e/audit-history-db.cjs` at 21:30 UTC, then `AT TIME ZONE 'Europe/Moscow'`, Moscow headings, and the three stale comments. The Transactions screen is UTC throughout by design (#212, kept in #318). Moving it to Moscow days changes the whole screen and is an owner decision. | S |
| A-70 | **P1.** Float products become saved amounts. `AddTransactionDialog.tsx:627-631` multiplies with `Number()` and rounds with `toFixed` (half to nearest). "Use" puts the result into the saved `grossUsd`/`incomeValueUsd`. The owner sees the figure before saving, so impact is small. | Add `productDown(left, right, places)` to `frontend/src/utils/decimal.ts` and use it at :628 and :631. Use the already imported `subtractDecimal` at :1085. RED test: a reward of `123456789.123456789` at `12345.6789` must give the exact truncated total. | S |
| A-92 | **P1.** More browser write chains than ADR-001 action 6 names. `AddBrokerDialog.tsx:360-424` writes the account, then up to four writes per holding, with a 91-line client-side compensation. `AddPropertyDialog.tsx:133-191` writes account, asset, trade and prices, and fires `removeAccount` without waiting for it. | Widen ADR-001 action 6 to one backend command shared by add-asset, add-broker and add-property: for example `POST accounts` with `openingHoldings`, written in one transaction under one request id. The prerequisite is a real-PostgreSQL test in which a refused holding leaves no rows. Leave the hide/show token loops: they touch no money and are retry-safe. The owner decides the API shape. | L |
| A-33 | Two jobs share advisory-lock key `7_340_600_021` (`inflation.service.ts:35`, `broker-price-sync.service.ts:34`, since #353). Overlapping ticks return `busy` and self-heal at the next tick. | RED unit spec that captures all five job keys and asserts they differ. Then give broker price sync a new key. Keep the e2e-pinned keys 001, 002 and 011. | S |
| A-34 | The Bybit price outcome is never truncated, but the column is `varchar(300)`. About 40 uncatalogued tickers overflow it, the Bybit transaction rolls back and `collectTokens` is skipped. Prices, FX and inflation also re-implement the shared `recordSource`/`presentSource` (`backend/src/sync-status/sync-source.ts:29`) with different wording. | RED test with about 50 long codes. Then truncate once inside `recordSource` and route the three services through both helpers. This removes about 110 lines. | S |
| A-18 | Automatic staking rewards (`chain-classification.service.ts:301-306,719`) skip the USDT/USDC 1:1 rule that fee, pool, swap and list valuation apply. A USDT Bybit Earn yield gets the market price, or no value at all. | RED assertion in `tests/e2e/bybit-db.cjs` for the USDT Earn reward. Then call `storedValueUsd` and delete `centsOf`. | S |
| A-71 | `money()` (`frontend/src/features/portfolio/format.ts:73-88`) honours `rounding: 'up'` only for RUB. A €0.125 fee asked to round up shows €0.12, better than the real figure. `deposit-format.ts:122-137` is a second `money()` with different negative rounding; that difference cannot show today. | RED `format.test.ts` case. Then pass `ceil` for `'up'` to non-RUB amounts, update the pinned expectation at :102 as an intended change, and re-export portfolio `money` from deposit-format. | S |
| A-90 | Seven failure texts say "Nothing was saved" when the server never answered, for example `DepositDialogs.tsx:73`, `ClassifyForm.tsx:688` and `InflationSettings.tsx:75`. The client's own comment says a timed-out write often finished. `GoalDialogs.tsx:54-58` already words this correctly. | Rewrite each text in place following the goals wording. Add a network-error test per site first. Update `TransactionsPage.test.tsx:2139` and `WalletsPage.test.tsx:2306`, which pin the false text. | S |
| A-72 | `pageHandlesError` (`frontend/src/api/client.ts:145`) lacks `/wallet-addresses`, `/inflation` and `/owner-settings`. Those screens report errors themselves, so the global toast fires as well. | Copy the `client.test.ts:369` case for each prefix, see it fail, then add the three prefixes. | S |
| A-73 | The sidebar's attention count never runs. `AttentionProvider` wraps only `<Outlet/>` (`frontend/src/components/Layout.tsx:283`), but the plate renders in `<nav>`. The unit test mocks the context, and the e2e test pins the text you get without it. | Move the provider to wrap the whole `.shell`. Add a failing `Layout.bell.test.tsx` case, then update `wallet-addresses.spec.ts:346`. Keep the other pollers: they keep the last answer after a failed read. | S |
| A-74 | `AssetPage.tsx:656-681` loads the portfolio with no request guard, so a late answer for the previous currency overwrites the new one. AssetPage has no unit test. | First a failing `AssetPage.test.tsx` that switches currency mid-load. Then move AssetPage's, PortfolioPage's and WalletPage's portfolio and operations loaders to `useCachedRead`. | M |
| G1-01 | The owner export labels chain-produced rewards from the journal category (`backend/src/owner-export/owner-export.ts:160`). The Transactions list shows pool rewards, pool withdrawals and incoming "Other" by their answer type. The export calls an unclassified receipt of unknown value a "reward". | RED case in `tests/e2e/owner-export-db.cjs`. Then read the latest classification type in the rewards select, and import the type maps from `operation-list.ts` instead of copying them. | S |
| A-03 | Paid amounts that round to zero raise `BadRequestException` inside a command transaction. `rethrowAccountingHistory` (`connected-accounting.store.ts:406`) maps every such exception to 409, so a real 400 reaches the client as "does not fit the saved history". | RED HTTP test for a RUB trade whose USD gross rounds to zero, expecting 400. Then give stored-row checks a `storedDecimal()` that throws `FifoHistoryError`, drop `BadRequestException` from the rethrow, and delete the workaround at `trade.service.ts:482`. Grep the probes for any 409 that relied on the mapping first. | M |
| A-111 | Frontend tests serve invented partial shapes through 26 `as unknown as` casts (for example `NotificationsBell.test.tsx:53`). AGENTS.md requires real response shapes. No test was shown to pass only because of this. | Add complete builders in `frontend/src/test/api-fixtures.ts`, typed without casts. Move one feature per commit, and keep each test's effective values with explicit overrides. | M |

Smaller fixes with visible effect:

- **A-35:** The sync sidebar names only Bitcoin, Ethereum and Solana (`backend/src/sync-status/sync-status.service.ts:27`). Use `networkNames` from `chain-assets.ts`, after a failing Tron test.
- **A-57:** `inflation-math.ts:20-23` has no NaN guard, so `from=2026-13-01` answers 500 instead of 400. RED test, then one NaN-safe `isDay` used by the six day validators.
- **A-106:** The reset page lets a NUL character through, while the change-password dialog rejects it (`ResetPasswordPage.tsx:28`). Change the regex after a failing test.
- **A-104:** Transactions and Wallets shorten the same address differently. Make `operation-format.ts` call `shortValue`.
- **A-81:** `ThemeContext.tsx:17` trusts any stored theme string, and the file has Russian comments. Derive the resolved theme with `useMediaQuery`, accept only the three valid values, and translate the comments.
- **G1-02, G1-04:** The CSV archive lists removed wallets and accounts as live, and omits share splits, which change FIFO units. Add `removed_at` columns and a `splits.csv`, each after a failing probe case.
- **G4-02, G4-03:** `.ui-row > :first-child` collapses icon-less list rows (`frontend/src/ui/list-row.css:46`): Settings is affected and two features patch it locally. The Banks page forks `PageIntro` in CSS and loses the full-width button on phones. Both need new screenshots.

## Roadmap for maintainability

Do these as small pure refactors. The existing passing tests are the baseline and stay unchanged, as AGENTS.md requires. Each package can ship as one or a few PRs, and none needs another first, except where noted.

**1. Shared backend primitives.** These are cheap and remove the most copies.
- `readOnlyTransaction(source, work)` in `backend/src/shared/` for the 29 sites (A-04). Keep `rethrowAccountingHistory` at the five call sites that use it.
- Export `ATOM_SCALE` and the signed parsers from `money.ts`. Put `moscowDayStart` next to `moscowDate` (A-11).
- `strictQueryInteger` in `shared/strict-input.ts` for the eight `queryInteger` copies, each keeping its bounds (A-10). One NaN-safe `isDay` (A-57).
- One `ProviderFailure` type and one failure-text map in `sync-status/sync-source.ts` (A-38). One exported `SYNC_TIME_BUDGET_MS` (A-41).
- Named constants instead of literal limits: `MAX_ACTIVE_TRADES`, `MAX_CARRY_IN_LOTS` and one journal-revision cap (A-09). Export `ANONYMOUS_MS` (A-69). Use `trim_scale` for decimal text (A-68). Use `estimateOf` in the goal chart (A-67).
- Biome reports nine `useMathMinMax` warnings on BigInt comparisons, where `Math.min` cannot apply. A `minAtoms`/`maxAtoms` pair in `money.ts` would remove the ternaries and the warnings. This item came from the lint baseline and was not part of adversarial verification.

**2. Accounting.** These reduce what a new ledger kind or chain classification must touch.
- `instrument.store.ts` with one `insertInstrument` and `findOrCreateInstrument` for the three instrument inserts (A-08). An exported `findInstrument` for the read-only callers (A-29).
- Move the empty-journal insert, the opening check and `execution()` into `trade-journal.store.ts` (A-12).
- One local helper for the three non-trade `readLedgers` blocks, and one `readEntryCounts` (A-06).
- The operation list's trade query built from `versionSelect` plus a shared `tradeVersionDetailJoins` fragment, also used by the owner export (A-21, G1-03).
- In `chain-classification.service.ts` (2,230 lines): a private `recordAutomatic` for the three recognizers (A-19). Then one pure move of its SQL helpers into `chain-classification.store.ts`, following `chain-duplicate.store.ts` (A-20).
- Gate the needs-classification badge's two exclusions on the answer, as the list does, after a probe that shows the counts differ (A-17).
- `PoolLeg = SwapSide` and module-level leg helpers in the operation list (A-27). Extract `realizedTotals` from `projectPortfolio` (A-28). One `closingValue` in the snapshot service (A-24). One `mutualBest` (A-26). A private `chainSwap` helper (A-13).
- A unit spec that checks the snapshot input tables against `backupTables`, with a recorded reason per excluded table (A-53).
- A parity loop for `kind: 'account'` in `deposit-interest.spec.ts` (A-54). MFA completion through `proveFactor`, inside `mfa.service.ts` only and with an independent review (A-52).

**3. Provider integrations.** Adding a chain today means 3–4 new files and edits in about 12 places (`chain-assets.ts`, `wallet-address-input.ts`, the module in five places, `env.validation.ts`, `price-catalog.ts`, `bybit-records.ts`, `backup-tables.ts`, a migration, the e2e counts and the shard registry).
- One `insertLegs` for the seven batch leg inserts, chunked at 1,000 rows (A-36).
- Move the identical `errorCode` into one module (A-37). A full shared HTTP client is not recommended: the 11 clients differ in real quirks.
- Move the pure row-to-API mapping out of `wallet-address.service.ts` the next time wallet summaries change (A-39).
- Extract the T-Bank preview hash and holding comparison, after a golden test pins the digest (A-40).
- One `saveTbankConnection` (A-42), one insert-or-revive statement (A-43), Ethereum assets built from `evmChains` (A-44), and one download per inflation provider (A-49).

**4. Dead code.** Delete it; deletion lowers what every later change must read.
- **Shipped with no route:** the CSV import service with its input and parser, two valuation services (A-22), and the standalone methods of the manual swap and carry-in services (A-07, about 1.5k lines in all). These are reachable only from database probes. The swap methods are `create`/`correct`/`void`/`list`/`listVersions`/`getAllocation`, and the carry-in methods are `state`/`preview`/`initialize`/`listLots`. Keep the transaction-scoped entry points and their parsers, because production calls them: `AssetSwapService.mutateWithin` with `parseSwapCreate`/`parseSwapVoid` from chain classification (`chain-classification.service.ts:1319,1420,2020`), and `CarryInService.initializeWithin` from broker import (`broker-import.service.ts:249`). Remove only the standalone methods and their exclusive helpers, in reviewed slices that first move the probes onto SQL seeds or live readers, as AGENTS.md requires for E2E pruning.
- **Backend:** `@nestjs/swagger` with its compile plugin and 19 decorators (A-56; the coordinator owns the lockfile). The `AppController` scaffold (A-58). `DISPLAY_FX_*` variables (A-59). The unused decorator branch (A-60). A stray re-export (A-61). A duplicate currency list (A-62). `formatSats` (A-45). `receivedBtc`…`feeBtc` aliases in the wallet API (A-48).
- **Frontend:** `ErrorContext` (A-79), `refreshUser` (A-80), `logger.ts` (A-82), the unused `api/index.ts` barrel (A-85), the `@hooks` alias (A-86), the `DASH` re-export (A-103), and dead shared CSS rules (G4-06).
- **Tests and scripts:** `browserPost` (A-113), mocks of deleted pages (A-114), a no-op env stub (A-115), and `.github/scripts/generate-release-notes.sh` (G2-06).
- **Owner approval needed:** the retired `resume-fresh` branches in `cd.yml` and the server scripts (G3-05, G2-01). The first-install data assessment script (G2-07).

**5. Frontend structure.**
- `useCachedRead` for the portfolio and operations loaders (A-74). Fix the hook's comment, which claims every page already uses it.
- One shared `FormDialog` for goals and deposits, with `useFocusFirstProblem` in ClassifyForm (A-77).
- Move the chart helpers out of `HistoryChart.tsx` into `ui/chart.ts`, with `useChartWidth` (the `useLayoutEffect` version) and `useChartCursor` (A-93). This also breaks the dashboard↔goals import cycle. Keep the scales, paths and markup per chart.
- Move `icons.tsx` and `CloseButton.tsx` into `ui/`, so `ui/` stops depending on a feature (A-76). Keep `format.ts` where AGENTS.md names it.
- Derive network order, names and coins from `wallets/networks.ts`, after a characterization test (A-75).
- Move the shared 409 parsers out of the `AddTransactionDialog` component (A-95). Use one `tradeRows` in `OperationDrawer` (A-98) and one `propertyNote` (A-101). Optionally a shared URL-params hook (A-97) and moving PortfolioPage's sort and summary code (A-96).
- `moscowDate` in place of three local "today" helpers (A-100). `useAttempt` at the plain single-id sites (A-102). The API type duplicates (A-78). Encoded path ids (A-88). One preload/skeleton test per shell section (A-89).
- CSS: the goal chart reuses `ui/chart.css` (G4-01). Glyph styles move into `TypeIcon`'s own stylesheet (G4-04). A test keeps the two light palettes equal (G4-07).

**6. Tests and tooling.** These cut the per-change chores listed in AGENTS.md.
- **Migration names:** one hand-written `tests/e2e/migration-ledger.cjs` list. A new migration then edits one line instead of about 60 lines in 50 files (A-107). These pins are release evidence, so the owner reviews it.
- **Probe registry:** a reverse completeness check in ENG-007-B, so an unregistered probe fails `test:engineering` (A-108). Manifest-derived counts computed rather than pinned, with one deliberate tripwire, and the missing file added to AGENTS.md (A-112).
- **Probe wiring:** one `tests/e2e/accounting-services.cjs` that builds `ChainClassificationService` with all five dependencies (A-25). Today 13 of 15 probes omit `AssetSwapService`. A `probe-kit.cjs` with only `createIsolatedDatabase` and `migrate` (A-109).
- **Test assertions:** `assert old in source` before each source rewrite in the privileged-script tests, where two rewrites are already dead (A-110). Playwright specs import `compose`/`query` from `mfa-fixtures` (A-119).
- **Test structure:** split `TransactionsPage.test.tsx` (4,774 lines) along its describe blocks (A-120).
- **Coverage:** measure all backend `src/**/*.ts`, not only services (A-117). No threshold, no gate change.
- **CI wiring:** `node --test scripts/` instead of five hand-listed files (G3-06). The candidate manifest export reuses `imageManifest` (G3-02). Exact duplicate `cd.yml` pins removed (G3-04). Installer tests build their file lists from the scripts (G2-04).
- **Error logging:** nine background catch blocks drop the error (GS-01). Log `error.name` only, because raw messages can carry keys. Give `linkQuietly` and its wrapper one honest name (GS-04). Reuse `requestFailure` in `RemoveAddress` (GS-05). Move `toneClass` next to `tone()` (GS-06). Replace the dead status switch in `client.ts` and drop comments that restate code (GS-07).
- **Optional dead-export gate:** about 115 integration exports and dozens elsewhere are exported but used only in their own file (A-47, A-83). Removing `export` by hand is churn that comes back. If the owner wants it, add a knip check as its own reviewed change first.

## Considered and not recommended

Verifiers checked these and advised against acting. They are listed so they are not raised again.

| ID | Proposal | Why not |
|---|---|---|
| A-46 | Remove the `parseFixedTermPositions` alias | It has a production caller and its own fixed-term spec. |
| A-63 | Typed retire helper for retired commands | A database CHECK already rejects an unknown scope, and each retire statement differs. |
| A-65 | Untangle deposits and snapshots | The import is type-only and the export reads different rows by design. |
| G1-05 | Row interfaces for the owner export | `manager.query` returns `any`, so interfaces cannot catch alias drift; the probe already does. |
| G3-07 | Derive the release image list | ADR-001's Redis removal deletes the only tag that changes. |
| A-05 | One generic command skeleton for all entry kinds | The copies differ in limits, journals and error causes. Only the trade replay order is worth aligning, behind an acceptance test, if the owner wants it. |
| A-14 | Rewrite the old-schema migration probes now | Convert each seed when the next schema change breaks it. |
| A-16 | `replyCreated()` helper and route renames | Saves nothing per handler, and the frontend and e2e pin the routes. |
| A-23 | Delete `calculateFifo` | It is the canonical unit-test driver for `FifoBook`. |
| A-50, A-51 | EvmReader shared state; holding rules in the price job | No await separates write and read; the price scope differs from visibility on purpose. |
| A-64 | Remove the auth entities and serializer | Low value for an auth-wide change. |
| A-87, A-91, A-94, A-105 | Folder moves, a shared wallet-dialog component, moving ClassifyForm's logic, renaming label maps | Moves without a demonstrated need, or they would lose page-specific rules. |
| A-99 | Stable error codes everywhere at once | Add a code per response when a slice next changes that error. |
| A-116, A-118, A-121 | Wire manual tools into CI, drop SQL-text spec pins, merge provider host lists | Manual tools by design. Most pins are real oracles. Host-list drift fails loudly in E2E. |
| G2-03, G2-05, G3-01, G3-03, GS-03 | Merge path-trust checks, receipt checks, workflow readers and FIFO type checks | They live in owner-installed server code, or the duplicate is a few lines with one consumer. |

## Owner decisions needed

1. Should the Transactions screen move from UTC days to Moscow days as a whole: entry, headings, filters and presets (A-01)?
2. What shape should the combined account-with-holdings command have (A-92, extending ADR-001 action 6)?
3. Approve the release-evidence pin changes: one migration ledger, a probe-registry completeness check, and computed manifest counts (A-107, A-108, A-112).
4. Approve removing the retired `resume-fresh` paths and the first-install data assessment from owner-installed scripts (G2-01, G2-07, G3-05). Time this with a release that already reinstalls the dispatcher, such as ADR-001's Redis removal.
5. Should a dead-export gate (knip) become part of lint (A-47, A-83)?
6. Inflation factors are floats that feed displayed real-profit amounts (`inflation-math.ts`). The goal-projection exception does not name them. Confirm they are display-only estimates, or record an exception.

## Patterns to keep and copy

- Pure planners behind thin services: `chain-transfer`, `chain-swap`, `chain-pool`, `available-quantity`, `trade-order` and `paid-currency`, each with its own spec.
- Version rows behind a head pointer, with canonical-payload replay under the owner advisory lock, taken before sorted row locks.
- One FIFO cost engine (`FifoBook`, `LotInterval`, `CostTally`) in which missing cost stays null.
- `wallet-sync.service.ts` with `ChainSyncAdapter`: the scheduler/adapter split other jobs should follow. Per-row cursor commits in one transaction.
- Provider clients that take `baseUrl`, `timeoutMs` and `pauseMs`, tested against real local HTTP servers.
- `backup-tables.ts` with its export probe, and `route-inventory.spec.ts` guarding `@Public` and `@AllowPending`.
- `useCachedRead` with `cachedReads`, as goals and deposits use them. `ui/ConfirmDialog` with `requestFailure`. The inline `newAccount` in `AddWalletDialog`, which is the model for A-92.
- `format.ts`, which formats the decimal string with an explicit rounding direction, and totals that never count missing as zero.

## Tool baseline at the source commit

| Measure | Value |
|---|---|
| Non-test source, backend / frontend | about 50k / 36k lines |
| Exact clones in `src/` (jscpd, 60 tokens) | 1.48%, 83 clones |
| Exact clones in containerized probes | 10.1%, about 5,500 lines |
| Exports used only inside their own file (knip) | 83 values, 107 types |
| Biome warnings, backend / frontend | 21 / 16 |
| Functions or components of 150+ / 100+ lines | 49 / 98 |
| Largest component, `AddTransactionDialog` | 1,005 lines |
| Largest file, `chain-classification.service.ts` | 2,230 lines |

Knip also listed migrations, probes and CLI entry points as unused files; these are false positives, loaded by glob or by name.

## Verification record

What ran:
- **Area reviews:** seven read-only reviewers covered the accounting write side, the accounting read side, provider integrations, the backend platform, the frontend platform, the frontend features, and tests with tooling.
- **Gap audits:** a completeness critic named four uncovered areas: the owner export, the release scripts, the engineering specs and the CSS. Those four were audited, plus a dedicated sweep for AI-generated slop.
- **Adversarial verification:** each finding went to separate skeptics for evidence, design and, for behaviour claims, runtime trace. Low-severity findings got one combined check. A finding counts as refuted when most verifiers refuted it. The corrected counts and file:line references above come from the verifiers.
- **Tools:** `knip@5`, `jscpd@4`, `pnpm --dir backend lint` and `pnpm --dir frontend lint` (both exit 0 with the warnings above), and a TypeScript AST function-length scan.

Not run: the backend and frontend test suites, the builds, Docker, the E2E suites, or any database query. Verifiers could run single existing unit tests to settle a behaviour claim; most claims were settled by reading code. Behaviour findings marked RED-first are reproduced only by reading, until their failing test is written. Line numbers refer to the source commit and will drift.
