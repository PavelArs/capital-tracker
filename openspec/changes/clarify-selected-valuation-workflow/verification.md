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

Independent diff review approved commit `805ae8b` for integration. Actual PostgreSQL/HTTPS browser acceptance remains pending; local Docker is unavailable, so no browser/runtime evidence is claimed here. Keep this change unarchived until the runtime gate is recorded.

## Limits

No runtime, release, production, or whole-redesign acceptance is claimed by component tests or build checks. No Docker or production actions are part of this change.

## Integrated source checks and pending browser evidence

Root integrated design commits `c7b0872` / `e9a3a88`, UI `805ae8b` / `f138f71`, and browser QA `2d2e293` / `29148e3` into the PR #29 worktree. The QA follow-up uses bounded actual Tab presses from the UTC input to reach each named region; independent review approved it without new browser test cases or weakened financial/security assertions. The existing MPV-UI journey now checks disclosure request preservation, both regions, containment and exact values at 360/768/1440 in light/dark, and saves six synthetic-portfolio screenshots. Discovery still lists exactly two MPV cases; these added checks are not yet executed.

Root reran focused frontend tests (4/4, 1.22 s), TypeScript/Vite build, frontend lint (exit 0, 27 existing warnings), backend MPV/historical regressions (68/68, 2.056 s), and strict OpenSpec validation (50/50) after integration. The earlier hosted allocation run 37008110156 does not include this UI source and must not be cited as its browser acceptance.
