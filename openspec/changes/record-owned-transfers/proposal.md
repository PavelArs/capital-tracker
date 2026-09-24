## Why

Tracked assets cannot currently move between manual accounts without being entered
as unrelated trades. The target requires internal movement to preserve acquisition
history and FIFO basis, charge its fee once, and remain reproducible after old edits.
The verified original-interval allocator is now available for that purpose.

## What Changes

- Record immutable, replay-safe owned transfer versions with atomic source/destination
  effects, correction and terminal void; no blockchain execution or synthetic trades.
- Replay complete connected account history with original-lot coordinates, including
  repeated and roundtrip transfers, later sales, declared fee-asset consumption and
  old trade/CSV corrections. Reject any negative historical prefix atomically.
- Invalidate all affected account read pins, distinguishing actual local trade
  versions from the explicit journal-revision capacity budget.
- Integrate shared replay into trade/CSV/history/valuation readers and writers.
- Add a Russian protected transfer screen with explicit account/revision review,
  exact receipts/provenance and safe retry after ambiguous transport failure.

## Capabilities

### New Capabilities
- `owned-account-transfers`: Exact manual internal movement with connected history and fee provenance.

### Modified Capabilities
- `usd-fifo-trades`: Transfer-aware inventory/provenance and connected revision validation.
- `usd-csv-imports`: Connected candidate preview/commit/rollback and honest revision capacity.
- `known-cost-carry-in`: Shared transfer-aware replay without changing immutable origins.
- `historical-accounting`: Inclusive effective transfer prefixes and dependency revision pins.
- `historical-account-valuation`: Value transfer-aware holdings from the same coherent snapshot.
- `account-valuation-history`: Reuse connected history once for unchanged bounded chart points.
- `manual-portfolio-valuation`: Selected accounts include internal movements without duplicated holdings.

## Impact

Accounting projector/store/service integrations, additive migration20 and private
transfer routes, API/types and Russian page. Retain existing journal/account/instrument
identities, saved trades/CSV originals/receipts, auth/MFA, exact prices and all owner data.
No external USD flow is created, changed or inferred. No provider/dependency/pipeline
replacement; retain inspected GHCR/Compose/guarded manualCD, no production rollout.
No chart period/layout work or original-repository move/deletion.

Scope is recorded movements between existing initialized declared-empty/known-cost
manual journals. Unknown-cost opening conversion, cash ledger, swaps/rewards, observed
blockchain reconciliation and CSV transfer import remain separate full-goal work.
No frozen source histories or one-hop-only shortcut. The app records an already
performed movement; it never sends funds or signs a transaction.
