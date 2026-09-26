# Transfer workbench verification

Status: active; not yet verified or archived.

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
