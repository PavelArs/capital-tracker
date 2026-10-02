# Verification — clarify-selected-valuation-workflow

## Scope

Presentation-only change in `ManualPortfolioValuation.tsx`, its CSS, focused component test and `docs/manual-portfolio-valuation.md`. Financial view conversion and the calculation, selection, invalidation and request functions remain unchanged. Real PostgreSQL/HTTPS and responsive browser acceptance are separate evidence gates.

## Acceptance-first evidence

- The first focused assertion was added and failed against the original rendering before product edits; it reported the absent selected-manual scope warning. The initial UI draft preceded completion of the OpenSpec artifacts, a sequence deviation.
- To restore the required artifact-first evidence, the TSX/CSS draft was saved as `/private/tmp/valuation-workflow-product.patch` (SHA-256 `4aa4effb9f146736733d775bb5df2c84adab000deba126f640bd0abccf80854e`) and those two source files were restored to base `8e9ee38`. After completing the proposal, design, scenarios and tasks, strict validation passed for the change and the unchanged-source component test again failed on the absent scope warning. The patch was then reapplied; the final implementation moves instrument evidence before account evidence.

## Actual local results

Environment: Node 22.23.2, pnpm 10.33.0.

| Check | Result |
| --- | --- |
| Focused component and view tests | 4/4 passed (2 files) |
| Affected-file Biome check | Passed for the component, stylesheet and component test |
| Frontend build and TypeScript | Passed; existing Vite large-chunk warning remains |
| Strict OpenSpec validation | 50 passed, 0 failed |

The selected text and focus outline use the existing `--primary-color-dark` token. Measured contrast against the theme backgrounds is 8.39:1 in light (`#2d5072` on `#ffffff`) and 9.27:1 in dark (`#acd1f4` on `#202930`).

Independent diff review and actual PostgreSQL/HTTPS browser acceptance remain pending. Local Docker is unavailable, so no browser/runtime evidence is claimed here. Keep this change unarchived until required review and runtime gates are recorded.

## Limits

No runtime, release, production, or whole-redesign acceptance is claimed by component tests or build checks. No Docker or production actions are part of this change.
