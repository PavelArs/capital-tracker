## Context

Base2616db4 has42canonical specs/no active change. Read AGENTS, continuity, target redesign amendment, existing acquisition-entry/swaps/reward specs and current owners/forms/tests. Existing pipeline remains manually gated workflow_dispatch/main/PRODUCTION_ROLLOUT_ENABLED, unchanged.

Keep exact values, original review/reset/recovery/controller semantics, mounted independent operation drafts, immutable receipts/versions and pagination. Simplify navigation between saved rows and editor/history. Remove no supported behavior, tests, data or folders. Original cancel resets the selected operation to its blank create draft; do not invent draft-preservation semantics for cancellation.

## Goals / Non-Goals

**Goals:** predictable explicit-action focus for swap/reward correction, void, cancellation and history close.
**Non-Goals:** controller/accounting/API/auth/schema/provider changes, broad form layout redesign, dependencies, automatic actions, deployment or consolidation.

## Decisions

- Root owns AssetSwaps.tsx and shared OperationForm.css; Luna owns only AssetRewards.tsx in capital-tracker-reward-focus. Sol owns existing SWAP-UI/REWARD-UI acceptance additions in capital-test-acquisition-focus. Separate source/oracle review precedes archive; root alone owns Docker/integration.
- Wrap each unchanged form in a named region using mode labels, tabindex-1 and scoped operation-workbench class; a region avoids duplicating the nested fieldset's group role/name. Stable section h2 and newly rendered history h4 are focus targets. No conditional editor mounting or new keys.
- Use separate editor/history initiating-button refs and a sequenced request kind editor/history/return-editor/return-history. A layout effect depending only on this explicit request applies focus after commit. Stage captures trigger and requests editor focus only after its existing guard/actions; cancel appends return request after original resets.
- First-page history actions capture the origin, invoke original loadHistory and request history focus immediately. Pagination leaves the opener unchanged. Close invokes original clearHistory before requesting return; its existing generation invalidates pending reads. The history opener is disabled while loading, so restoration occurs after commit when idle state is rendered, not synchronously before it re-enables. Connected/enabled origins receive focus, otherwise the stable section heading. Async completions never change focus requests.
- Add minimal shared min-width/scroll-margin/focus outline styles. No form/controller props or old guards change. Retain prior full acquisition-entry responsive evidence; capture actual new focused editor/history contexts at360dark and1440light without repeating the entire unchanged six-viewport layout matrix.

## Risks / Trade-offs

- Late history/refetch steals focus → effects depend only on user request, real delayed response tests.
- Pending close sees a stale disabled trigger → restore after commit, test pending-close origin return and no reopening.
- Cancellation changes economic intent/other drafts → append focus behavior only; preserve original blank reset, request guards and separate trade draft assertions.
- Saved row disappears → connected/enabled check and stable heading fallback, source review plus live-origin browser checks.

## Verification and rollback

Baseline118frontend characterization. Extend existing SWAP-UI and REWARD-UI before product edits; expected actual RED at correction editor focus. Preserve real committed identical retry, explicit zero/unknown/fee/category evidence, late-review invalidation, original correction/void and independent draft oracles. New history delays use actual route.fetch responses only; stage/cancel/close must not POST or change financial fingerprints/provider counters. Retained WORKFLOW-UI covers shared operation mounting/drafts/focus.

Required selected3real HTTPS/password/MFA/backend/PostgreSQL22migrations journeys and artifact/proxy checks, local frontend tests/build/lint, strict all-E2E types, scoped Biome, production audit, strict OpenSpec, independent source/oracle and bounded actual focused-state visual review. Full backend/E2E/API/precision/upgrade/live-provider/security/release suites unrun. No schema/quota changes; rollback frontend only. Preserve Nginx/lock/preview, archive then compare41othercanonical files plus3old/2newacquisition requirements before guarded integration/temporarylink cleanup.
