# Period-review workbench verification

Status: specified; acceptance and implementation pending. Whole-refactor goal remains active.

Base97ca8da, root branch refactor/redesign-period-review-workbench. Read AGENTS, target brief/redesign amendment, current continuity, canonical profit/XIRR/TWR specifications, source/controllers and current manually gated CI/CD. Keep/simplify/remove inventory and isolated file ownership are in design.md. No backend/auth/API/migration/dependency/pipeline changes planned.

Baseline `pnpm --dir frontend test` exited0:118tests/21files on Node22.23.2; log `/private/tmp/capital-period-workbench-baseline.log`. Supported OpenSpec1.2.0 new/status/instructions workflow used. Predecessor FEsha256:048b059e457731b7692617f1484d9d8fac29bc50cae7aecbc8fc758516ba089c; unchanged BEsha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2.

Required manifest: existing extended PROFIT-UI/LATE and LTWR-UI cover PERIOD-UX-001-A/002-A/B/003-A; retained XIRR-UI/LATE and TWR-UI cover001-B/shared result regression. Use real HTTPS/password/MFA/backend/PostgreSQL22migrations and release artifact/proxy gates, external fixtures only. Preserve exact economic/private/fingerprint/admission/provider assertions and request ceilings. Actual light/dark360/768/1440 captures, independent product review and root acceptance-oracle review are required. Local frontend118characterization/build/lint, strict all-E2E types, scoped Biome, production dependency audit and strict OpenSpec required.

Full backend/E2E suites, populated upgrade matrix, live providers, scanners/DAST, hostedCI, production/preview rollout and consolidation remain outside this bounded frontend slice and are not claimed. Existing passing characterization is retained for pure presentation changes; new native-disclosure interaction must first fail on predecessor.
