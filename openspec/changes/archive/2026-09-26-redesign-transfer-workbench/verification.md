# Transfer workbench verification

Status: complete, archived and integrated; all6tasks complete.

## Scope and baseline

Base859f267, branch refactor/redesign-transfer-workbench. Main repository has only the preserved owner frontend/nginx.conf edit. Read AGENTS, target brief, continuity, existing transfer spec, source, selected tests, CI/CD and synthetic Compose. No pipeline replacement or deployment; existing production gate remains disabled unless explicitly enabled by owner. Static movement inventory retained at /private/tmp/capital-movement-inventory.md; bounded keep/simplify/remove decision is in design.md.

- Frontend baseline: `pnpm --dir frontend test`, exit0,21files/118tests,3.50s. `/private/tmp/capital-transfer-workbench-baseline.log`.
- OpenSpec1.2.0: supported new/status/instructions/apply workflow; `openspec validate --all --strict --no-interactive`,38items pass (37canonical plus this change). `/private/tmp/capital-transfer-workbench-specs-baseline.log`.
- Predecessor FE sha256:e50994254810e656a7614ed9d2716fe9cdb863c4631fa3e38c17cd6cdd7e8f43; unchanged BE sha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2.
- Before runtime, no capital-tracker-e2e containers; preview containers remain exited and capital-tracker-preview_preview_data exists. Preview is not updated by this slice.

## Required check manifest

TRANSFER-UI is extended with TRANSFER-UX-001-A,002-A/B,003-A/B, preserving original exact principal/fee/retry/holdings/provider assertions. WORKFLOW-UI characterizes shared operation presentation. Both run on actual synthetic HTTPS proxy, password/MFA sessions, backend and PostgreSQL after22migrations; only external providers use fixtures. Run frontend tests/build/lint, strict E2E TypeScript, scoped Biome, production dependency audit and strict OpenSpec. Source review checks financial controller/guards and control signatures; independent visual review covers actual viewport captures at360/768/1440 in both themes.

Full E2E/backend suites, populated upgrade matrix, live provider checks, scanners/DAST, hostedCI and production release are outside this frontend slice and have not run here. Existing suites/gates are retained. Responsive captures do not imply every recovery/error state was visually reviewed or whole frontend/owner approval.

## Acceptance-first RED

Independent Sol acceptance commit5144617 integrated as42f918f before product edits. Scoped strict TypeScript, frontend-config Biome and diff-check passed in the acceptance worktree. Root reviewed the test diff; all original financial/retry/privacy/provider oracles retained.

`caffeinate -is node /private/tmp/capital-transfer-workbench-browser.cjs red` exited1 as expected on the predecessor FE above. TRANSFER-UI failed specifically at the recipient field accessible-description expectation: expected meaning that recipient quantity excludes fee, actual empty description. Application startup,22migrations, actual owner/MFA and artifact gates succeeded; this was not an environment failure. Log `/private/tmp/capital-transfer-workbench-red.log`, copied failure artifacts `/private/tmp/capital-transfer-workbench-red-artifacts`. Disposable E2E services/networks were removed in the harness finally block.

## Implementation and local gates

Product3492cd6 (page/focus/history) plus Luna41a49ce integrated06c0514 (form), CSS followup5d52cac. Independent source reviewer found draft guidance ambiguity and separated fee descriptions; corrected before GREEN to explicit recipient-fee exclusion, both fee hints on both controls and operation-wide millisecond ordering. Review paragraph is outside button row. Source review of5d52cac has no blocking findings; visual review pending.

- Structured TypeScript AST audit, `/private/tmp/capital-transfer-workbench-control-audit.cjs`:14form control signatures unchanged versus859f267 (type/inputMode/value/checked/required/disabled/onChange/onSubmit/onClick). Root and independent reviewer separately checked options, exact strings, controller/write/recovery guards.
- Author's earlier component-test attempt did not start: ERR_REQUIRE_ESM from html-encoding-sniffer/exodus worker under its local runtime. Not counted as a pass; temporary symlink removed. Root used the required available Node22.23.2 and ran the whole frontend characterization below successfully.
- `pnpm --dir frontend test`: exit0,21files/118tests,5.47s. Log `/private/tmp/capital-transfer-workbench-unit.log`.
- `pnpm --dir frontend build`: exit0, existing >500kB bundle warning. Log `...-build.log`.
- `pnpm --dir frontend lint`: exit0,27existing warnings. Log `...-lint.log`.
- Strict all-E2E TypeScript from backend: exit0; `pnpm exec tsc --noEmit --strict --target ES2022 --module commonjs --moduleResolution node --esModuleInterop --skipLibCheck ../tests/e2e/*.ts`. Log `...-types.log`.
- Scoped frontend-config Biome and git diff-check: exit0. Logs `...-style.log`; form checked separately by author.
- `pnpm audit:production`: exit0,2existingmoderate, no high/critical; no dependency changes. Log `...-audit.log`.
- `docker build -f frontend/Dockerfile -t capital-tracker-frontend:acceptance .`: exit0. Log `...-image.log`; candidate FE sha256:ebdc0e74e6e439bc93a492f46f71f61b2e45f8ad8308900fa321664aa54da0b7. Backend remains dd90a8c5 above.

## Actual GREEN

`caffeinate -is node /private/tmp/capital-transfer-workbench-browser.cjs green` exited0 on candidate FEebdc0e74 and unchanged BEdd90a8c5. Two selected journeys passed with1worker/0retries in31.5s: WORKFLOW-UI16.0s and TRANSFER-UI14.8s. Log `/private/tmp/capital-transfer-workbench-green.log`. Fresh synthetic PostgreSQL22migrations, actual owner bootstrap/password/MFA and production-artifact checks ran successfully. Only external provider fixtures are substituted. The browser genuinely commits a transfer, loses delivery using route.fetch/abort, retries the unchanged command, and later corrects and voids it. Assertions retain receipt equality, fee basis20USD, restored source/recipient basis300/0USD and provider counters.

New focus/description/identity/guard assertions passed, including a delayed real version response that does not steal moved focus and no mutation from selecting/cancelling. Light/dark360/768/1440 checks retain no page-level overflow and44px main controls; presentation changes preserve business fingerprints and provider counters.24 actual viewport images (12editor +12history) are copied under `/private/tmp/capital-transfer-workbench-green-artifacts/owned-transfers-TRANSFER-U-7319a-inal-void-use-real-receipts-chromium`. No masking or hidden skip-link manipulation. Screenshots show the post-create blank editor and saved allocation/version history, not all correction/recovery/error states.

Harness finally cleanup completed with exit0. No full-suite repetition was needed for this bounded frontend change.

## Independent review and preservation

Sol source/acceptance/history review: [review.md](review.md); Luna independent editor review: [editor-visual-review.md](editor-visual-review.md). Both reviewed their12 actual screenshots,24total, after the successful run. No unresolved blocking findings. Minor desktop auto-fit layout inefficiency (recipient quantity occupies the next row) is recorded as nonblocking; no extra runtime claim is made for absent filled/error screenshots. Root also inspected mobile light editor and desktop dark history.

Final strict OpenSpec validation:38items pass. Final labeled Docker inventory showed no E2E containers/networks. Preview containers remain exited, preserved volume capital-tracker-preview_preview_data exists, and original FEpreview sha256:7eff01d148e8f286c025655ffa0dd88cfa842fc051d9dd9240318c11cc60768c is unchanged. Owner Nginx mode0644,size1348,SHA256115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432; lock SHA2566a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d. No owner data, production, remote push or original project cleanup.

## Archive

OpenSpec1.2.0 `openspec archive redesign-transfer-workbench --yes` exited0 and created `2026-09-26-redesign-transfer-workbench`. The CLI warned5/6tasks because final task3.2 deliberately includes archive/canonical comparison/integration, not unfinished product verification. All product/runtime/review gates were complete before archive; the final checkbox is completed only after the remaining procedure. Log `/private/tmp/capital-transfer-workbench-archive.log`.

Post-archive comparison confirms all3 new requirement blocks match the archived delta (only blank-line normalization) and all37previous canonical files remain byte-identical to859f267. The generated Purpose placeholder was replaced with the actual capability purpose. Strict38canonical specs pass, active changes list is empty. Logs `...-canonical.log` and `...-specs-archived.log`.

Product and archive56b6856 fast-forward integrated into refactor/brownfield-baseline
after verifying its starting HEAD859f267 and sole owner Nginx edit. Only the three
exact temporary integration-worktree node_modules symlinks were unlinked after
verification; primary dependencies remain. QA/form worktrees are clean and retained.
Task3.2 was then completed. Final bookkeeping is documentation only; no new product
changes or unsupported rerun claims. The whole-refactor goal remains active.
