## Context

Based on d4dd415:40canonical specs and no active change. Read AGENTS, target brief/redesign amendment, continuity, manual-price spec/API/controller/tests and current CI/CD. Existing pipeline remains manually gated and unchanged. Page-only styles have no other consumers. Current table applies flex directly to td, history/editor actions lack focus guidance, and editor follows long evidence sections.

Keep exact strings/explicit zero, full instrument UUIDs, all write/read/recovery guards, immutable history, receipts, request identity, pagination and price-only provider-free behavior. Simplify section order, rules prose and row navigation. Remove no supported capability, tests, data or project folders.

## Goals / Non-Goals

**Goals:** a focused manual price workflow with predictable action navigation and responsive exact evidence.
**Non-Goals:** automatic prices, backend/API/auth/accounting changes, dependencies/component library migration, production/preview deployment or consolidation.

## Decisions

- Root owns ManualPrices.tsx and integration; Sol owns existing acceptance extension in capital-test-price-workbench; Luna owns only ManualPrices.css in capital-tracker-price-styles. A separate reviewer owns independent product/oracle review.
- Place the unchanged editor after selection and always-visible recovery/status output, ahead of current book/history. Native `Правила ручных цен` details retain full identity/correction/void scope; keep essential manual/unreconciled/isolated-point limitations visible. Add descriptions outside existing labels without changing values/handlers/guards.
- Reuse the event-only focus pattern from flow/transfer workbenches: refs for page/editor/history headings, separate initiating action refs and a sequence-triggered layout effect changed only by user action. Original showHistory/clearHistory controllers remain unchanged. New history close calls clearHistory, invalidating late responses. Existing void cancel state changes remain and add live/enabled focus restoration. No asynchronous callback requests focus.
- Keep semantic td elements; put flex on a nested action wrapper. Caption and named focusable scroll region retain exact UTC/unit price/manual source. History retains immutable revision/kind/price/time values, including zero/void markers. Use scoped flat4px cards, readable tokens,44px targets, min-width:0 and exact text wrapping.

## Risks / Trade-offs

- Recovery lost or successful save relabeled failure → untouched owner recovery map/subscriptions, controller/guard audit and retained real lost-response/accepted-refresh acceptance.
- Wrong instrument identity or zero interpreted as missing → unchanged UUID option labels/raw strings, explicit associated guidance and retained financial oracles.
- Late read steals focus/reopens closed panel → focus requested only by click, existing generations invalidated by close, real delayed history delivery checks.
- Editor reorder/long UUID causes overflow → preserve controlled inputs, semantic cells, scoped contained scrolling and actual360/768/1440 captures in both themes.

## Verification and migration

Baseline118frontend characterization tests. Extend existing PRICE-UI/PRICE-RECOVERY before product changes; observe intended missing-guidance/disclosure RED on predecessorFE78436d00. One selected real journey covers affected save/correct/history/void/reload/uncertain-delivery/selection behavior; no new browser case. Existing API/PG unit/precision suites retained but not repeated for this frontend-only slice. Root alone runs synthetic HTTPS/password/MFA/backend/PG22migrations and artifact/proxy gates; only external providers are fixtures.

Required: frontend tests/build/lint, strict all-E2E types, scoped Biome, production audit, strict OpenSpec, independent source/oracle and actual viewport review. Full backend/E2E, upgrades, live providers/scanners/hostedCI/release unrun. No migration, quota or service changes; rollback frontend-only. Preserve owner Nginx/lock and preview. Archive after gates, compare40old canonical files and3new blocks, guarded integration and temporary-link cleanup only.
