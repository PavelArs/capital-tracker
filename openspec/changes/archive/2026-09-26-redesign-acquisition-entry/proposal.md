## Why

Swap and reward entry still mix amounts, time and evidence in a single grid with
distant instructions and oversized action rows. Trade entry has a clearer grouped
pattern; applying it consistently makes financial distinctions easier to understand.

## What Changes

- Group swap assets/quantities, explicit valuation, fee source and execution time.
- Group reward receipt, independent basis/income evidence and receipt time.
- Associate concise existing financial guidance with the relevant controls; retain
  every exact label, conditional field, string value, review and recovery guard.
- Share presentation styles with trade entry and arrange explicit review/submit/cancel
  actions consistently at mobile/tablet/desktop sizes in both themes.

## Capabilities

### New Capabilities
- `acquisition-entry`: Consistent precise swap/reward forms with accessible evidence guidance.

### Modified Capabilities
None. Accounting, immutable commands, history and recovery semantics remain unchanged.

## Impact

AssetSwapForm, AssetRewardForm and shared form CSS, with a presentation-only extraction
from TradeForm. Existing real browser journeys gain guidance/responsive assertions.
No controller/backend/schema/dependency/auth/provider/deployment changes or user data
impact. Depends on0fc48f7. Other editors, history focus navigation, review/history
hierarchy, validation redesign and preview rollout remain separate frontend tasks.
