# Period-review workbench verification

Status: archived and integrated; all six slice tasks complete. Whole-refactor goal remains active.

Base97ca8da, root branch refactor/redesign-period-review-workbench. Read AGENTS, target brief/redesign amendment, current continuity, canonical profit/XIRR/TWR specifications, source/controllers and current manually gated CI/CD. Keep/simplify/remove inventory and isolated file ownership are in design.md. No backend/auth/API/migration/dependency/pipeline changes planned.

Baseline `pnpm --dir frontend test` exited0:118tests/21files in3.53s on Node22.23.2; log `/private/tmp/capital-period-workbench-baseline.log`. Supported OpenSpec1.2.0 new/status/instructions workflow used;40items strict validation passed (39canonical plus this change). Predecessor FEsha256:048b059e457731b7692617f1484d9d8fac29bc50cae7aecbc8fc758516ba089c; unchanged BEsha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2.

Required manifest: existing extended PROFIT-UI/LATE and LTWR-UI cover PERIOD-UX-001-A/002-A/B/003-A; retained XIRR-UI/LATE and TWR-UI cover001-B/shared result regression. Use real HTTPS/password/MFA/backend/PostgreSQL22migrations and release artifact/proxy gates, external fixtures only. Preserve exact economic/private/fingerprint/admission/provider assertions and request ceilings. Actual light/dark360/768/1440 captures, independent product review and root acceptance-oracle review are required. Local frontend118characterization/build/lint, strict all-E2E types, scoped Biome, production dependency audit and strict OpenSpec required.

Full backend/E2E suites, populated upgrade matrix, live providers, scanners/DAST, hostedCI, production/preview rollout and consolidation remain outside this bounded frontend slice and are not claimed. Existing passing characterization is retained for pure presentation changes; new native-disclosure interaction must first fail on predecessor.

## Acceptance-first RED

Sol acceptance74f464c integrated7a7c22e, independently reviewed by root: existing financial/private/late/refusal/admission/provider oracles and request ceilings preserved. Scoped Biome and strict all-E2E TypeScript passed in the acceptance worktree. Screenshot-only followup b8a229a integrated5c3824a adds actual collapsed-header captures after the RED run; it does not alter the failure oracle.

`caffeinate -is node /private/tmp/capital-period-workbench-browser.cjs red` exited1 on predecessorFE048b059e. Actual HTTPS/password/MFA/PG22 migrations and release artifact/proxy gates passed; PROFIT-UI failed at the intended absent `Как считаются показатели` summary, bounded10s toBeVisible assertion. Product files were unchanged until this observed failure. Log `/private/tmp/capital-period-workbench-red.log`, copied `...-red-artifacts`. Harness cleanup completed.

Separate reviewer preimplementation inspection found no blocking design issue and identified mounted-state, closed-edit invalidation, distinct financial scope and label/evidence visibility as final-review checks. Root maintains all pre-render controller/module logic and15 control/props signatures under structural AST comparison; final audit and runtime remain required.

Production dependency gate exited0 with2existing moderate findings and nohigh/critical; `/private/tmp/capital-period-workbench-audit.log`. No dependencies or lock changed.

## Candidate implementation and local gates

RootTSX17d5d46, LunaCSS7418c04 integrated7312fbb and rootCSSfollowup bcb9699. Integration review corrected the linked section's paragraph-by-paragraph two-column grid, kept all four main inputs in one responsive field group, and supplied exact primary-value wrapping/default-margin reset. Styles use readable existing text/focus tokens and container-aware field columns. No controller/API/auth/backend change.

- Structural audit `/private/tmp/capital-period-workbench-control-audit.cjs`: all15control/props signatures and all module/pre-render controller logic in both TSX files unchanged versus97ca8da; `...-controls.log`. Separate source review checks mounting, labels and result branches beyond this audit.
- Frontend118tests/21files PASS3.94s; `...-unit.log`.
- Frontend build PASS1.04s with existing >500kB warning; `...-build.log`.
- Frontend lint PASS with27existing warnings; `...-lint.log`.
- Strict all-E2E TypeScript from backend PASS: `pnpm exec tsc --noEmit --strict --target ES2022 --module commonjs --moduleResolution node --esModuleInterop --skipLibCheck ../tests/e2e/*.ts`; `...-types.log`.
- Scoped per-package Biome6files and diff-check PASS; `...-style.log`.
- Frontend image build PASS; `...-image.log`. Candidate FEsha256:78436d00c6a36f0109abe0505dbff20fc21d8fe67642cc605b79d3dc51b3fa41; backenddd90a8c5 unchanged.

## Actual GREEN

`caffeinate -is node /private/tmp/capital-period-workbench-browser.cjs green` exited0 on candidateFE78436d00 and unchangedBEdd90a8c5. Four selected existing journeys passed in51.7s, one worker/zero retries: LTWR-UI14.7s, PROFIT-UI/LATE13.1s, TWR-UI11.7s, XIRR-UI/LATE11.5s. Log `/private/tmp/capital-period-workbench-green.log`. Fresh synthetic PostgreSQL22migrations, actual password/MFA bootstrap and production-artifact/proxy gates passed. Only external providers are fixtures. Harness finally cleanup completed.

Exact zero/loss profit, annual XIRR10, period TWR10, linked TWR21/profit310, unavailable reasons, genuine failed/delayed backend delivery and stale-plan409 assertions pass. New native method/evidence/linked toggles make no requests. Closed-state edits retain the original distinct valuation/date invalidation semantics; folding/reopening preserves reviewed1100, plan and actual linked result. Existing financial fingerprints/admission/provider oracles and ceilings remain unchanged.

All viewport assertions pass for light/dark360/768/1440, including no page overflow,44px main controls and actual keyboard-contained linked table scrolling. Forty-two real viewport frames are copied under `/private/tmp/capital-period-workbench-green-artifacts`:20profit(header/inputs/result) and22linked(inputs/review/result). Root additionally viewed light1440header, dark360profit and light768linkedreview. No masks, element-only screenshots or hidden skip-link manipulation.

Independent source/oracle review and all20profit frames passed with no blocking findings; [report](review.md). Linked product visuals passed separate review of all22frames, [report](linked-visual-review.md). The linked reviewer authored acceptance but no product; independent source/oracle reviewer authored neither. Actual captures cover successful reviewed states, not every unavailable/error state or a broad screen-reader/zoom audit. XIRR/TWR behavior has selected runtime assertions; those two result cards do not have dedicated visual captures in this slice.

Final pre-archive strict OpenSpec validation passed40items (39canonical plus change). Docker label inventories have no E2E containers/networks. Preview containers remain exited44hours, its durable volume exists and original FEpreview sha256:7eff01d148e8f286c025655ffa0dd88cfa842fc051d9dd9240318c11cc60768c is unchanged. Main remains at97ca8da with only the unrelated owner Nginx edit: mode0644,size1348,SHA256115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432. Lock SHA2566a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d remains unchanged. No owner data access, production/preview deployment, push or original project cleanup.

## Archive

OpenSpec1.2.0 `openspec archive redesign-period-review-workbench --yes` exited0 and
created `2026-09-27-redesign-period-review-workbench`, synchronizing all3requirements.
The CLI warned5/6tasks because final task3.2 includes archive/comparison/integration,
not unfinished product checks. The checkbox is completed only after that procedure.
Log `/private/tmp/capital-period-workbench-archive.log`.

All39previous canonical files remain byte-identical to97ca8da; all3new requirement
blocks match the archived delta after blank-line normalization. Generated Purpose
placeholder replaced with the actual capability purpose. Strict40canonical specs pass;
active changes are empty. Logs `...-canonical.log` and `...-specs-archived.log`.

Product/archive55600d8 fast-forward integrated into refactor/brownfield-baseline after
guarding its starting97ca8da HEAD, sole owner Nginx edit and protected file hashes.
Only seven exact temporary dependency symlinks in the integration/QA/CSS worktrees
were unlinked; all primary dependencies and source worktrees remain. Task3.2 was then
completed. Final bookkeeping changes documentation only and claims no extra product
test run or whole-redesign completion.
