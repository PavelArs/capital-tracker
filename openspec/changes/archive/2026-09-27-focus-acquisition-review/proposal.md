## Why

Swap and reward entry is already grouped and responsive, but row correction/void/history actions leave keyboard users away from their new review context. This is the remaining acquisition navigation followup in the required whole-frontend redesign.

## What Changes

- Move focus on explicit correction/void actions to a named editor region; cancel returns to the initiating row control, otherwise a stable section heading.
- Focus newly opened history immediately; add close with late-read invalidation and return to its initiating control after the UI commits.
- Keep original financial/recovery/read controllers, cancellation resets, independently mounted drafts, exact review/receipt evidence and pagination behavior.
- Add only shared scoped focus-target styles; extend existing critical acquisition E2E journeys.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `acquisition-entry`: add event-only correction/void/history focus and cancellation/close behavior while preserving the three existing entry requirements.

## Impact

AssetSwaps.tsx, AssetRewards.tsx and small focus styles in OperationForm.css. Existing SWAP-UI/REWARD-UI extended; WORKFLOW-UI retained. No backend/API/auth/schema/dependency/provider/pipeline changes, data migration, deployment or consolidation. Depends on verified acquisition entry; remaining analytics/editor workflows and full-redesign approval stay separate.
