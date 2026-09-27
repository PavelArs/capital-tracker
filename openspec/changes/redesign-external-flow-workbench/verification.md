# External-flow workbench verification

Status: active, implementation and verification pending.

## Baseline and manifest

Base75a0f6b, root branch refactor/redesign-external-flow-workbench. Read AGENTS, target brief/redesign amendment, continuity, flow specifications/controller/tests and existing manually gated CI/CD. Keep/simplify/remove inventory and file ownership are in design.md. Owner Nginx remains the sole unrelated main-worktree edit; no data, backend, dependency or pipeline change is planned.

- `pnpm --dir frontend test`: exit0,118tests/21files,3.57s on Node22.23.2. `/private/tmp/capital-flow-workbench-baseline.log`.
- Supported OpenSpec1.2.0 new/status/instructions/apply; strict all-validation39items pass (38canonical plus change). `/private/tmp/capital-flow-workbench-specs-baseline.log`.
- Predecessor FE sha256:ebdc0e74e6e439bc93a492f46f71f61b2e45f8ad8308900fa321664aa54da0b7; unchanged BE sha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2.
- No E2E containers before the run; durable preview volume capital-tracker-preview_preview_data exists and is outside cleanup.

Required: independently extended existing FLOW-004-A for FLOW-UX-001-A/002-A/B/003-A plus retained stale/paging/exact financial evidence; unchanged FLOW-004-B recovery for003-B through real HTTPS/password/MFA/backend/PostgreSQL22migrations and artifact gates. Providers only use fixtures. Root owns disposable capital-tracker-e2e, no production Compose. Local frontend118 characterization/build/lint, strict all-E2E types, scoped formatter, production audit, OpenSpec, independent source/oracle and actual viewport review are required before archive. Preserve existing fingerprints, admission counters, exact receipts/pins/totals and provider assertions.

Full backend/E2E suites, populated upgrade matrix, live providers, scanners/DAST, hostedCI and production/preview deployment are outside this frontend slice and have not run here. Static views do not establish every error/recovery state's visual quality or whole-frontend/owner approval.

## Acceptance-first RED and review handoff

Sol independently authored acceptance5df23b9 integrated564621d. Root review caught two test-only issues before runtime: period guidance was asserted before initialization (those fields do not exist until the journal is initialized), and a DOM inspection lacked a bounded visibility assertion.303f430 fixes the test ordering/wait; no financial assertion changed. Agent first type invocation lacked Node types, then corrected installed backend tsc with explicit typeRoots passed; scoped Biome/diff checks passed.

`caffeinate -is node /private/tmp/capital-flow-workbench-browser.cjs red` exited1 on FEebdc0e74. Failure was the intended absent native rules control, `Правила учёта потоков`, after successful real startup/authentication/migrations/artifact gates. `/private/tmp/capital-flow-workbench-red.log` and copied `...-red-artifacts`. E2E cleanup completed. Product edits began only afterward.

Thread capacity prevented a fresh reviewer thread. The Sol acceptance author is independently reviewing root/Luna product implementation; root separately reviewed the acceptance oracles. Final report will distinguish those roles and not claim that the author independently reviewed their own tests.
