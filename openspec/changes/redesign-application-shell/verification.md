# Verification record — redesign-application-shell

## Preparation,2026-09-26

Root audited App routes, Layout/mobile measurement logic, global/auth styles,
account/journal composition, legacy dashboard, settings and installed package
manifest at4decf5a. The inventory in docs/frontend-screen-audit.md distinguishes
source findings from visual/runtime verification. Read target amendment and canonical
auth/accounting/retired-liability contracts. Existing owner Nginx edit remains solely
in the integration checkout and must never be staged.

Created isolated worktree `/Users/pavelars/Projects/temp/capital-tracker-frontend-shell`,
branch `refactor/frontend-shell`, from4decf5a. Root owns only this change's frontend,
acceptance and documentation in this worktree; shared Docker/migrations/dependencies/
deployment ownership remains centralized. No dependency links or packages added.

Used installed OpenSpec1.2.0 `new change`, `status --json` and `instructions` for
proposal/design/specs/tasks in dependency order. All artifacts describe intended
behavior, not completed implementation. Existing swap change stays active at9/12;
its independent persistence/UI review is still required. No unavailable agent was
reinvoked and no paid fallback was used.

No shell acceptance test, RED, runtime baseline, new screenshot, build, dependency
audit or implementation pass is claimed yet. First task is current characterization
and executable acceptance before changing behavior. Pure styling retains passing
characterization; new landing/navigation interactions require genuine RED.

Actual strict `openspec validate --all --strict --no-interactive` with telemetry
disabled passes30/30 items, `/private/tmp/capital-shell-proposal-validation.log`.
`instructions apply --change redesign-application-shell --json` reports ready with
0/8implementation tasks complete; artifact completion is not product completion.
`git diff --check` passes. These are preparation checks only.

## Acceptance baseline and genuine RED, 2026-09-26

Implementation starts from 34e924b in the isolated shell worktree. Temporary
root/frontend/backend node_modules symlinks reuse the existing integration install;
no package or lock changes. These links are local tooling, never committed. Current
host Node 22.23.2/pnpm 10.33.0/Vitest 4.1.2; images retain pinned Node 22.21.1.

- `pnpm --dir frontend exec vitest run --coverage=false`:109 tests / 17 files PASS in 2.81s,
  `/private/tmp/capital-shell-baseline-unit.log`. Retained auth and accounting
  characterization passed before product edits.
- New Layout static presentation tests use actual contexts and server rendering,
  which executes no auth effects; no API/context substitute. All 3 genuinely failed
  on predecessor: unnamed nav, absent aria-current and absent legacy disclosure.
  `/private/tmp/capital-shell-unit-red.log`, exit 1. Static rendering is not proof of
  authenticated browser behavior; interactions are checked in the real journey.
- New SHELL-UI against predecessor BE dd90a8c5/FE 7eff01d1 completed actual password and
  TOTP through HTTPS/PostgreSQL, then failed expected `/manual-accounts` versus actual
  `/`. This is behavioral RED, not a fixture/build/credential failure.
  `/private/tmp/capital-shell-browser-red.log`, exit 1; synthetic screenshots/trace
  `/private/tmp/capital-shell-browser-red-artifacts`.
- Harness `/private/tmp/capital-shell-browser.cjs red` used only capital-tracker-e2e,
  fresh schema 22 migrations/production CLI seed, two actual backend replicas and release
  artifact checks. Its finally cleanup removed the disposable containers/networks.
  Owner preview project, durable volume, key, credentials and tags were not changed.

SHELL-002-B additionally extends the retained SWAP-UI journey: while a real committed
response is lost, fill a separate trade draft and change 360/768/1440 widths/open-close
navigation. Assert the same editor DOM remains attached, both exact input values stay,
retry remains explicit and POST count does not increase. All pre-existing accounting,
receipt, stale-review, correction/void and SPA recovery assertions remain unchanged.

## Initial implementation checks and correction

Layout now uses CSS grid and an in-flow compact disclosure without measured heights,
timeouts or transition callbacks. Same Outlet remains mounted. Active NavLinks,
skip-to-main, Escape focus, route close, explicit legacy grouping/notice and root
redirect are implemented. Login logic and logout error handling are retained; only
semantic wrappers/presentation change. Shared palette/focus/reduced-motion tokens
are updated; no financial formatter, API, schema, preference storage or retry change.

- Frontend unit suite 112 tests / 18 files PASS in 2.80s, `/private/tmp/capital-shell-unit-green.log`.
  This includes3 new static shell tests plus all 109 predecessor checks.
- Frontend build exit 0, `/private/tmp/capital-shell-build.log`; existing Vite chunk
  warning>500kB retained. Frontend lint exit 0 with 27 existing warnings, no new warning,
  `/private/tmp/capital-shell-lint.log`. A new unnecessary effect-dependency warning
  was resolved before the final lint by deriving the legacy route inside the effect.
- Strict E2E TypeScript exit 0, `/private/tmp/capital-shell-e2e-types2.log`, repeated
  after browser additions in `...-types3.log`. Command is run from backend cwd with
  `pnpm exec tsc --noEmit --strict --noUnusedLocals --noUnusedParameters --skipLibCheck
  --target ES2022 --module commonjs --moduleResolution node --esModuleInterop
  --types node --typeRoots ./node_modules/@types ../tests/e2e/*.ts`.
  First attempt expanded that glob from the repository root and failed before tsc;
  it is not counted as a type-check pass.
- Strict OpenSpec 30/30 PASS, `/private/tmp/capital-shell-specs.log`.
- Initial production audit could not reach npm inside sandbox (ENOTFOUND,exit 1),
  `/private/tmp/capital-shell-production-audit.log`. Authorized network-enabled
  retry exit 0:2 moderate findings, no high/critical, `...-production-audit2.log`.
  No dependency/lock change and no advisory suppression.

First real GREEN attempt used FE sha256:73271ab556dd16ec1eeee10631aae1ae12ce348818800422e7479977ae682fc4
and retained BE sha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2.
SWAP-UI passed, including the added no-remount/explicit-retry/responsive draft checks.
SHELL-UI reached all landing/menu/theme/legacy assertions, then timed out because the
new test used logout label “Выйти” instead of existing ru.json label “Выход”. The
latter remains visible in the actual screenshot and unchanged in the product. Fix
only the new selector to the retained exact label; keep actual logout/private API 401
assertions. Overall 1 passed / 1 failed in 2.2m, no retries. Log `...-browser-green.log`,
artifacts `...-browser-green-artifacts`; failure evidence preserved.

Source review also updated the existing portfolio helper to expand the specified
legacy group and select its new label “Криптокошельки”; all existing wallet/auth/data
assertions remain. Add retained ISO-003-B to the narrow rerun to verify that helper
and direct reload through actual authentication, without running full provider tests.
SHELL-UI now additionally checks real incorrect-password error, recovery presentation
and creates/reads an actual saved account through the UI/root redirect. It does not
claim a new recovery-code redemption matrix.

Root inspected real synthetic 360px login/MFA/menu and 1440px light/dark screenshots; the
shell fits and controls are legible. Account content remains the predecessor layout,
including excessive valuation explanation/long editors, explicitly pending FUI-03/04.
This is root inspection, not independent review or owner visual acceptance. Error
text was changed to normal high-contrast text with an error border before rebuilding.
Final candidate FE sha256:62543d34b7a1f20e88944f245ebece7543edd2a762c83ac74e5c57106f8ce823;
`/private/tmp/capital-shell-image-build2.log`, exit 0. Preview tags remain unchanged.

## Final scoped GREEN and remaining gates

`caffeinate -is node /private/tmp/capital-shell-browser2.cjs green` exited0.
Final candidate FE 62543d34 / unchanged BE dd90a8c5 above were inspected by the harness;
actual migration 22, seed and release/proxy isolation checks passed. **3/3 PASS in 34.5s**,
one Chromium worker, zero retries:

- SHELL-UI 11.4s: real private/password-only API 401, wrong-password error, TOTP and
  recovery presentation, UI account create and root reload/read, grouped navigation,
  accurate menu aria state, Escape/focus/hidden-tab behavior,360/768/1440px overflow,
  skip link, light/dark, legacy scope and actual logout revocation/private401.
- SWAP-UI 12.3s: same attached editor and exact independent draft through width/menu
  changes; no implicit retry, then retained real committed-response-loss/SPA replay,
  immutable receipt/pins, stale-review refusal, exact allocation, correction and void.
- ISO-003-B 10.1s: retained real password/MFA, revised legacy navigation and authenticated
  wallet reload; foreign wallet data remains absent. This is not full provider coverage.

Log `/private/tmp/capital-shell-browser-green2.log`; eight synthetic screenshots in
`/private/tmp/capital-shell-browser-green2-artifacts/application-shell-SHELL-UI-e62ba-est-legacy-entry-and-logout-chromium/`:
login-360, login-error-360, mfa-360, recovery-360, menu-360, menu-768,
accounts-1440-light and accounts-1440-dark. Root inspected the screenshots (including
updated error/recovery and 768px saved-account layout). Actual no-overflow assertions
cover the final image; screenshots alone are not accessibility certification.
Changed frontend Biome check and E2E formatting exit 0 in
`/private/tmp/capital-shell-changed-check.log` and `...-e2e-format.log`.

Final live labeled Docker inventories: no capital-tracker-e2e containers/networks.
Separate preview volume `capital-tracker-preview_preview_data` exists; its containers
remain stopped 30 hours earlier. No preview tag/data/key/credential or owner repository
was reset. Original projects and production remain untouched. Owner Nginx SHA256
115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432 and lock SHA256
6a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d remain unchanged.

Unrun: full browser/device matrix, unrelated backend suites and migration matrices,
new recovery-redemption matrix, hosted CI, full release/security/backup gates, all FUI
acceptance and owner visual review. Backend/schema/provider code is unchanged, so
those broader checks were not repeated for this bounded shell slice. Existing tests
remain; no financial/security assertion was removed or relaxed.

Independent review remains blocked by the observed agent quotas (carry_docs_review
and historical_ui until Sep30; gate_acceptance until Sep29). No retry/purchase/fallback
was attempted. Root source/screenshot inspection is explicitly not independent review.
Tasks 1.1/1.2/2.1/2.2/2.3/3.2 complete, 3.1/3.3 pending;6/8. Do not archive or synchronize
canonical shell specifications until independent review and any resulting checks pass.

Local implementation committed as4049132 and fast-forwarded into the integration
branch without changing the owner Nginx edit. The shell worktree is clean; its three
explicit temporary node_modules symlinks were removed, preserving actual installed
packages. No project/worktree directories were deleted. Post-integration strict
OpenSpec again passes30/30 and apply reports6/8, in `/private/tmp/capital-shell-integrated-specs.log`
and `...-integrated-apply.json`. Canonical specs, backend, deployment, CI, lock and
tracked Nginx have no committed diff from34e924b. Independent review/archive still pending.
