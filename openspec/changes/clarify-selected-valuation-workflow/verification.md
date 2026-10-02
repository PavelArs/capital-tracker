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

## Integrated source checks and current readability acceptance

Root integrated design commits `c7b0872` / `e9a3a88`, UI `805ae8b` / `f138f71`, and browser QA `2d2e293` / `29148e3` into the PR #29 worktree. The QA follow-up uses bounded actual Tab presses from the UTC input to reach each named region; independent review approved it without new browser test cases or weakened financial/security assertions. The existing MPV-UI journey checks disclosure request preservation, both regions, containment and exact values at 360/768/1440 in light/dark, and saves six synthetic-portfolio screenshots. That journey executed in REAL green CI run 37013305851 on source `8e4b292`; its screenshots showed the numeric-wrap issue recorded below, so a fresh-source acceptance run remains necessary.

Root reran focused frontend tests (4/4, 1.22 s), TypeScript/Vite build, frontend lint (exit 0, 27 existing warnings), backend MPV/historical regressions (68/68, 2.056 s), and strict OpenSpec validation (50/50) after integration. The earlier hosted allocation run 37008110156 does not include this UI source and must not be cited as its browser acceptance. The existing browser journey did execute in run 37013305851 on source `8e4b292`, captured all six frames and passed its functional assertions; the 360px/768px layout was then rejected on visual inspection for wrapped numeric cells/headers.

## Readable-table visual finding

Hosted REAL green CI run 37013305851 evaluated source `8e4b292`. Its six actual-app screenshots are in `/private/tmp/capital-mvp-ui-ci-37013305851-mpv-ui/` (`valuation-{light,dark}-{360,768,1440}.png`). The 360px and 768px frames show exact numeric values broken across lines and column headers compressed into vertical fragments in both result tables. This is the actual visual acceptance rejection driving task 2.3; it is not a manufactured unit-test RED. Preserve the existing passing component/view characterization tests while fixing CSS layout.

Pending after this finding: independent CSS review and a fresh real browser run against the new source. The prior run is evidence of the rejected layout only; it is not acceptance of this fix. No Docker/production action was run here.

## Existing characterization preserved

Before the CSS implementation, the unchanged `ManualPortfolioValuation.test.tsx` and `manual-portfolio-view.test.ts` passed 4/4 under Node 22.23.2. A fresh frozen install was attempted with pnpm 10.33.0 but package tarball fetches failed with `ENOTFOUND`; the worktree package manifests and lockfile were byte-identical to the adjacent frozen valuation worktree, so the existing frontend dependency installation was linked temporarily for this narrow check. No dependency manifest or lockfile changed. This pure CSS correction does not use a manufactured component-test RED.

After the CSS change, the same component and view tests passed 4/4 again. Affected-file Biome passed for the TSX/CSS files; the frontend TypeScript/Vite build passed with the existing large-chunk warning; strict OpenSpec validation passed 51/51. Independent review approved commit `dc91b10`; it found no issue in the scoped table layout, spacing, preserved state/values, table semantics or OpenSpec history. No real-browser run was made on this source; fresh hosted frame/overflow checks and screenshots remain pending.

Root integrated the readable-table fix `dc91b10` / review `f3cfc52` as `9d5d550` / `ed42773`, plus QA `729df28` as `d7e12cc`. Root's combined-source checks passed four focused component/view tests (1.12 s), frontend TypeScript/Vite build and strict OpenSpec validation (49/49 after separately archiving the verified allocation/image fixes). Browser discovery still lists the two existing MPV cases; it is not execution. The fourteen planned real-app frames cover complete (six), missing-price (four) and unknown-history (four) states. These new assertions/frames are not established by prior run 37013305851 and require the next hosted run.
