## Why

The ledger now preserves ownership and original FIFO basis through transfers, but cannot
record an asset reward without inventing a purchase. Rewards may have unknown acquisition
cost and a separately declared income value; neither missing value may become zero.

## What Changes

- Record already-received manual rewards with explicit category, exact quantity/time,
  independently known-or-unknown acquisition basis and declared income value.
- Add immutable create/correct/terminal-void versions, protected Russian review and explicit
  identical retry, connected restatement and original reward provenance through FIFO/transfers.
- **BREAKING for newly introduced unknown-basis histories only:** affected cost and realized
  fields become nullable with explicit known subtotals/completeness; all-known predecessor
  amounts and untouched response shapes remain unchanged. Holdings and exact-price values
  remain available when acquisition basis is unknown.
- Add one empty additive reward journal migration; preserve all old rows and receipts.
- No swaps, automatic rewards/provider collection, tax calculation, cash inference, external
  flow creation, chart-period expansion, paid service or deployment in this change. Ambiguous
  economic receipts remain outside reward classification until owner review; reward subtype
  can explicitly remain unclassified, with a visible review marker.

## Capabilities

### New Capabilities

- `asset-reward-receipts`: exact categorized manual rewards, unknown basis/income, immutable
  lifecycle and protected Russian workflow.

### Modified Capabilities

- `usd-fifo-trades`: reward chronology/origin, partial cost coverage and exact known subtotals.
- `owned-account-transfers`: reward fragments and unknown basis survive movement/fees/replay.
- `historical-accounting`: reward-aware prefixes, nullable cost and coherent revision pins.
- `historical-account-valuation`: unknown basis does not become unknown quantity or a price.
- `account-valuation-history`: complete reward history loaded once for the bounded series.
- `manual-portfolio-valuation`: reward holdings priced by the existing explicit price source.
- `usd-csv-imports`: reward-aware candidate replay, completeness and saved-candidate invalidation.

## Impact

Depends on archived record-owned-transfers and existing empty/known-cost origins, session
security, exact manual prices and current-effect history. Touches accounting pure projection,
connected store/readers, new reward persistence/controller, existing result DTO/rendering,
and an account reward section. Root owns migration/shared runners; independent worktrees
own pure accounting and UI subsets. No dependency or deployment change is expected.
