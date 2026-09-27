# External-flow workbench verification

Status: product, selected runtime checks, independent review and archive comparison passed; integration procedure pending.

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

Thread capacity prevented a fresh reviewer thread. The Sol acceptance author independently reviewed root/Luna product implementation; root separately reviewed the acceptance oracles. The report distinguishes those roles and does not claim that the author independently reviewed their own tests.

## Implementation and local gates

Root TSX34aee29 plus Luna CSSa19c8d4 integrated26bd124, reviewed root followups b514f64/20d9feb. Root restored native summary markers (display:flex hid the disclosure marker), package formatting, consistent card spacing/focus and compact inline confirmation layout before runtime. Separate product reviewer found no blocking source or visual issue.

- `/private/tmp/capital-flow-workbench-control-audit.cjs`:11 form/input signatures unchanged and10financial/recovery/read controller definitions structurally unchanged versus75a0f6b. Log `...-controls.log`. Direct source review also checks original write/attestation/disabled expressions and table evidence.
- `pnpm --dir frontend test`: exit0,118tests/21files,4.89s. Log `...-unit.log`.
- Frontend build exit0 with existing >500kB warning; lint exit0 with27existing warnings. Logs `...-build.log`, `...-lint.log`.
- Strict all-E2E TypeScript from backend exit0: `pnpm exec tsc --noEmit --strict --target ES2022 --module commonjs --moduleResolution node --esModuleInterop --skipLibCheck ../tests/e2e/*.ts`; log `...-types.log`.
- Scoped frontend-config Biome and diff-check exit0; `...-style.log`.
- `pnpm audit:production`: exit0,2existing moderate, nohigh/critical; `...-audit.log`. No dependencies/lock change.
- Frontend acceptance image build exit0, `...-image.log`; FE sha256:048b059e457731b7692617f1484d9d8fac29bc50cae7aecbc8fc758516ba089c, backend remains dd90a8c5 above.

## Actual GREEN and independent review

`caffeinate -is node /private/tmp/capital-flow-workbench-browser.cjs green` exited 0 on the candidate FE048b059e and unchanged BEdd90a8c5. Both selected journeys passed with one worker and zero retries in 33.2s: FLOW-004-A 17.8s and FLOW-004-B 14.7s. Log `/private/tmp/capital-flow-workbench-green.log`; actual fresh synthetic PostgreSQL22 migrations, production artifact/proxy gates and password/MFA bootstrap passed. Only external providers use fixtures; financial writes and lost-response recovery pass through the real application and database.

Retained exact create1000/correction1200, unsaved1300 draft, pinned stale pagination, totals1250/2/1248 with52flows, immutable receipt/retry and lost-delivery/401/MFA/current-read recovery assertions pass. New associated guidance, native disclosure, immediate focus/cancel/close, delayed-real-read focus and close invalidation checks pass. Selection and presentation changes preserve business fingerprints and provider counters. Neither the request ceiling nor financial/security oracles were relaxed.

No page overflow and44px controls pass at360/768/1440 in both themes; narrow tables genuinely scroll by keyboard. All26 actual viewport screenshots were independently reviewed: six initialization, six filled correction, eight period segments and six version-panel frames. Evidence is copied to `/private/tmp/capital-flow-workbench-green-artifacts/external-usd-flows-FLOW-00-abd5c--and-reviews-a-contribution-chromium`. No masks or hidden skip-link manipulation. Root additionally inspected the light1440 correction and dark360 period frames.

See [product review](review.md) for reviewed sources, all26frames and limits. No blocking findings. At768 a long ISO input value can extend beyond its visible native input width; the complete returned period remains readable. This nonblocking observation does not establish screen-reader/zoom or every recovery/error state's visual quality. The whole frontend and owner visual approval remain open.

The harness finally cleanup completed and its terminal process exited0. Final pre-archive strict OpenSpec validation passed39items (38canonical plus this change). All required product gates passed before archive; full suites and other exclusions above remain explicitly unrun.

## Archive and preservation

OpenSpec1.2.0 `openspec archive redesign-external-flow-workbench --yes` exited0, created `2026-09-27-redesign-external-flow-workbench` and synchronized all three new requirements. The CLI warned5/6tasks because final task3.2 includes archive/comparison/integration, not unfinished product work. Its checkbox remains open until that procedure completes. Log `/private/tmp/capital-flow-workbench-archive.log`.

All38previous canonical files remain byte-identical to75a0f6b. All3new requirement blocks match the archived delta after blank-line normalization. The generated Purpose placeholder now states the verified capability. Strict39canonical specs pass and active changes are empty. Logs `...-canonical.log` and `...-specs-archived.log`.

Final labeled Docker inventory has no E2E containers/networks. Preview containers remain exited43hours, preserved volume `capital-tracker-preview_preview_data` exists, and original FE preview sha256:7eff01d148e8f286c025655ffa0dd88cfa842fc051d9dd9240318c11cc60768c remains unchanged. Main still starts at75a0f6b with only the owner Nginx edit. Owner Nginx SHA256115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432 and lock SHA2566a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d remain preserved. No owner data, production rollout, remote push or original project cleanup.
