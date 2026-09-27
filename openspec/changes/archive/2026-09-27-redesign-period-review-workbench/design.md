## Context

Base97ca8da;39canonical specs and no active changes before this slice. Current PeriodProfit and LinkedTwr controllers already enforce exact-string inputs, explicit reviewed requests and late-response invalidation. The page has long always-visible method prose, one-column fields, uniformly weighted results and permanently expanded linked review. Inspected the existing manually gated .github/workflows/cd.yml and CI; preserve both. Target brief permits reusing equivalent working controls, so no Mantine/ECharts or dependency migration is justified here.

Keep: all financial/API/auth contracts, raw decimal strings, controllers/guards, owner-key and period-key remounts, exact evidence, notices, missing-value markers and existing tests. Simplify: method prose, secondary editor visibility, field grouping and metric hierarchy. Remove: no supported capability, data, test suite, source project or deployment feature.

## Goals / Non-Goals

**Goals:** a focused period-review workflow, honest distinct metrics and responsive exact evidence.
**Non-Goals:** calculation/backend changes, new valuation providers, chart expansion, UI-library migration, production/preview rollout or consolidation.

## Decisions

- Root owns PeriodProfit.tsx/LinkedTwr.tsx and integration. Sol owns acceptance in capital-test-period-workbench. Luna owns only PeriodProfit.css in capital-tracker-period-styles. Separate product review context checks root/Luna changes; root independently reviews acceptance oracles.
- Native details/summary expose methods (`Как считаются показатели`), secondary journal evidence and linked TWR (`TWR с промежуточными оценками`). Keep manual/unreconciled/temporary/current-balance caveats visible. Do not hide errors, unavailable reasons or the primary metric behind evidence disclosure.
- Wrap the existing keyed LinkedTwr component in a native disclosure in its parent. The wrapper stays stable when period keys change; collapse does not unmount or reset the component. Existing date-key resets and valuation effects remain unchanged. No new automatic request, focus effect or derived economic state.
- Put exact primary metric first, keep selected period visible and original supporting amounts reachable. Native evidence disclosure contains full journal revision/coverage and explanatory detail; preserve dt/dd label relationships and exact strings. XIRR annualization and TWR period/rounding limits stay explicit.
- Group existing inputs with their current associated guidance. Use readable existing foreground tokens, flat compact bordered cards,44px actions/labels, min-width:0 ancestors, and a named focusable linked table region. No floating-point formatting.

## Risks / Trade-offs

- Distinct rates mistaken for equivalent metrics → explicit annual/period labels, preserved reasons and retained XIRR/TWR acceptance.
- Collapsing linked editor resets intent → native mounted disclosure outside period-key component; verify reviewed values/results survive toggles and closed-state edits invalidate correctly.
- Compact evidence hides financial context → visible scope/period/metric plus keyboard-expandable full evidence, exact assertions and screenshots.
- Long times/decimals cause mobile overflow → responsive groups and contained keyboard table scrolling, actual360/768/1440 captures in both themes.

## Verification and migration

Baseline frontend118 characterization tests. Extend existing PROFIT-UI/LATE and LTWR-UI before product changes; demonstrate missing new method disclosure RED on predecessor FE048b059e. Retain and run XIRR-UI/LATE and TWR-UI because their shared result presentation changes. No new browser test cases or financial-oracle weakening. Root alone runs fresh synthetic HTTPS/password/MFA/backend/PostgreSQL22 migrations and artifact gates; only external providers are fixtures.

Required gates: frontend tests/build/lint, strict all-E2E types, scoped Biome, production audit, strict OpenSpec, independent product/source/actual screenshot review and four selected real journeys. Full backend/E2E, upgrade matrix, live providers, scanners/DAST, hostedCI and production/preview deployment are unrun for this frontend-only slice. No migration, new quota, secret or service; rollback is frontend code/image only. Preserve owner Nginx/lock, durable preview and all source worktrees. Archive after all gates; compare39old canonical files and3new requirement blocks.
