# Period-review workbench verification

Status: real acceptance RED observed; implementation under review. Whole-refactor goal remains active.

Base97ca8da, root branch refactor/redesign-period-review-workbench. Read AGENTS, target brief/redesign amendment, current continuity, canonical profit/XIRR/TWR specifications, source/controllers and current manually gated CI/CD. Keep/simplify/remove inventory and isolated file ownership are in design.md. No backend/auth/API/migration/dependency/pipeline changes planned.

Baseline `pnpm --dir frontend test` exited0:118tests/21files in3.53s on Node22.23.2; log `/private/tmp/capital-period-workbench-baseline.log`. Supported OpenSpec1.2.0 new/status/instructions workflow used;40items strict validation passed (39canonical plus this change). Predecessor FEsha256:048b059e457731b7692617f1484d9d8fac29bc50cae7aecbc8fc758516ba089c; unchanged BEsha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2.

Required manifest: existing extended PROFIT-UI/LATE and LTWR-UI cover PERIOD-UX-001-A/002-A/B/003-A; retained XIRR-UI/LATE and TWR-UI cover001-B/shared result regression. Use real HTTPS/password/MFA/backend/PostgreSQL22migrations and release artifact/proxy gates, external fixtures only. Preserve exact economic/private/fingerprint/admission/provider assertions and request ceilings. Actual light/dark360/768/1440 captures, independent product review and root acceptance-oracle review are required. Local frontend118characterization/build/lint, strict all-E2E types, scoped Biome, production dependency audit and strict OpenSpec required.

Full backend/E2E suites, populated upgrade matrix, live providers, scanners/DAST, hostedCI, production/preview rollout and consolidation remain outside this bounded frontend slice and are not claimed. Existing passing characterization is retained for pure presentation changes; new native-disclosure interaction must first fail on predecessor.

## Acceptance-first RED

Sol acceptance74f464c integrated7a7c22e, independently reviewed by root: existing financial/private/late/refusal/admission/provider oracles and request ceilings preserved. Scoped Biome and strict all-E2E TypeScript passed in the acceptance worktree. Screenshot-only followup b8a229a integrated5c3824a adds actual collapsed-header captures after the RED run; it does not alter the failure oracle.

`caffeinate -is node /private/tmp/capital-period-workbench-browser.cjs red` exited1 on predecessorFE048b059e. Actual HTTPS/password/MFA/PG22 migrations and release artifact/proxy gates passed; PROFIT-UI failed at the intended absent `Как считаются показатели` summary, bounded10s toBeVisible assertion. Product files were unchanged until this observed failure. Log `/private/tmp/capital-period-workbench-red.log`, copied `...-red-artifacts`. Harness cleanup completed.

Separate reviewer preimplementation inspection found no blocking design issue and identified mounted-state, closed-edit invalidation, distinct financial scope and label/evidence visibility as final-review checks. Root maintains all pre-render controller/module logic and15 control/props signatures under structural AST comparison; final audit and runtime remain required.

Production dependency gate exited0 with2existing moderate findings and nohigh/critical; `/private/tmp/capital-period-workbench-audit.log`. No dependencies or lock changed.
