# Account analytics workbench verification

Status: verified and archived; guarded integration and final worktree cleanup follow.
The whole goal remains active.

Basec3a4dbd,42canonical specs, audited target/AGENTS/continuity/current UI/specs and
manually gated pipeline. Inventory and ownership are in design.md. No backend,
schema, API, auth, provider or dependency changes. Current30day/31point chart preserved.

Baseline frontend118tests/21files PASS3.29s; `/private/tmp/capital-analytics-workbench-baseline.log`.
Production audit exited0 with2existing moderate/nohighcritical, unchanged lockfile;
`...-audit.log`. Strict43items PASS (42canonical plus activechange); `...-specs.log`.

## Acceptance-first RED

Sol992afd3 integratedebfa44b changes six existing E2E files and adds one shared helper.
Seven existing browser journeys have updated task-selection prerequisites; no new cases.
Original financial/precision/quota/recovery/stale-response oracles remain. Independent
preimplementation source/oracle review found no blockers and confirmed hidden panel
checks cannot be satisfied by unmounting, wrong-owner hiding or all-hidden rendering.
Scoped Biome, strict all-E2E TypeScript/backend cwd and diff check passed.

`caffeinate -is node /private/tmp/capital-analytics-workbench-browser.cjs red` exited1
on predecessorFEeedaddee6. Real WORKSPACE-UI reached the intended10s failure: original
Учётный срез на дату heading remained visible after entering analytics, before any
new selector lookup. Actual HTTPS/password/MFA/backend/PostgreSQL22migrations and
release-artifact/proxy checks ran; only external providers used fixtures. Log
`...-red.log`, copied `...-red-artifacts`; disposable cleanup completed.

Predecessor frontend sha256:eedaddee6de4eb8719c7fe19d09400716a0d96ea994bef525c426ad99788a810;
backend sha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2.
Product implementation started only after this terminal expected failure was inspected.

## Candidate and local gates

Rootfc7c389 adds AccountAnalytics and read-tool presentation; LunaCSSe9e16b4 integrated
as7039fc4 after root applied the frontend package's formatter. Root9a5c82a groups
actions, restores block price/unknown-cost hints and keeps selector focus visible.
The three duplicate legacy CSS files were replaced by scoped AccountAnalytics.css.
No original handler, query, chart helper or account identity key changed.

- Original4module/controller bodies and27control/child/chart signatures PASS; chart
  helper byte-identical: `...-controls.log`.
- Frontend118tests/21files PASS4.04s, `...-unit.log`.
- Frontend build PASS1.10s, existing >500kB bundle warning, `...-build.log`.
- Frontend lint PASS27existing warnings, `...-lint.log`.
- Strict all-E2E TypeScript from backend cwd PASS, `...-types.log`.
- Scoped Biome13files PASS, `...-style.log`; diff check PASS.
- Frontend image build PASS, `...-image.log`: candidateFEsha256:
  d04f1d7ebc81929f827a196aa7b3f520c5165ac32c608486b860cb1cdee495d9.
  Backend remains dd90a8c5. The first selected GREEN failed as recorded below.

## First GREEN and review corrections

`...-browser.cjs green` exited1:3passed/2failed in1.4m,1worker. The late-read,
valuation and history journeys passed. WORKSPACE stopped at its new native-select
keyboard step: the installed macOS headless Chromium native popup ignored ArrowDown.
Pinned pagination reached every original financial/stale-page assertion, then its
unchanged total-call gate observed88 against the85 safety bound. The fixture used51
individual instrument-creation requests in addition to genuine mounted-owner reads.
There were no implicit valuation or value-history reads on task selection. Failed
trace/screenshots remain in `...-green-artifacts`; disposable cleanup completed.

Independent source review preserved original controllers/account keys/27signatures,
rendered financial references and byte-identical chart behavior. Actual dark history
frames exposed faint fixed Chart.js labels over the dark transparent surface. Root
6c06299 adds a scoped white plotting surface with border/radius; data/options remain
unchanged. A local default-sandbox image build initially could not access Docker;
the authorized local acceptance rebuild then exited0: `...-final-image.log`,
FEsha256:6ee61c50a0ea62d6e6542bd794a3de444312edd39ac2c3d6fc0114f8863aa479.
No preview/production image was replaced. Final runtime is recorded below.

A separate real native-select diagnostic ruled out Space/ArrowDown/Enter and the full
Chromium channel as fixes: both still retained the original value. Native type-ahead
works; Russian keys require trusted browser Input.dispatchKeyEvent because Playwright's
Unicode keyboard.type uses insertText, which does not select options. Actual keyDown/
keyUp for И and У selected history and accounting. The acceptance correction uses
that genuine browser keyboard input, retains all focus/value checks and does not
synthesize application DOM events. This diagnostic is not application acceptance.

The pinned fixture now prepares only the51catalogue rows using one atomic INSERT/
RETURNING in actual synthetic PostgreSQL, matching existing seedDiscovery practice.
Fresh UUIDs, SAME symbol, canonical payload/defaults and readInstrument checks remain.
Account/opening/carry preview/carry initialization/two trade commands still traverse
real authenticated API; original50+1page/order/exact-value/fingerprint/admission/4read
and85call-ceiling assertions remain. Catalogue-creation transport is independently
covered; this selected journey verifies history pagination, not51repeated creations.

## Final scoped verification

`caffeinate -is node /private/tmp/capital-analytics-workbench-browser.cjs final`
exited0:5/5 PASS in1.2m,1Chromium worker,0retries. Actual22migrations, release/proxy
checks, password/MFA and genuine backend/PostgreSQL ran. Only external providers used
fixtures; catalogue setup distinction is recorded above. Scenario durations:
WORKSPACE14.3s,HISTlate13.6s,HISTpinned13.3s,VAL14.3s,VCH15.8s.
Logs `...-final.log`, screenshots `...-final-artifacts` (38analytics frames).
Final accepted frontend6ee61c50, unchanged backenddd90a8c5 (full IDs above).

Final strict all-E2E types, scoped13-file Biome, original27control signatures/four
controllers and chart byte comparison, diff check and strict43OpenSpec items pass;
`...-final-types.log`, `...-final-style.log`, `...-final-controls.log`,
`...-final-specs.log`. Earlier118/21tests/build/lint/audit gates remain as recorded;
subsequent product change is only the chart-surface CSS, rebuilt and actually exercised.
No redundant full suite was run. Existing warnings/advisories are retained above.

Post-run Docker inventory confirms no capital-tracker-e2e containers or networks.
Preview remains stopped46hours with original volume/tag7eff01d1; no preview reset or
rollout. Original Nginx/lock hashes and main dependencies remain intact.

Independent review approved source/oracles and all38final light/dark frames:
14history by the gate reviewer,24accounting/valuation by Sol (not product author).
The dark-chart finding is resolved; exact review boundaries/nonblocking cosmetics
are in [review.md](review.md). No whole-redesign or owner-approval claim.

## Reviewed scope and unrun checks

Root owns new selector/composition and original read-tool presentation; Luna scoped CSS.
Structural controller/control/child/chart comparison prepared in
`/private/tmp/capital-analytics-workbench-control-audit.cjs`:27protected signatures and
original pre-render/module logic across4files, chart helper byte identity. This is
structural evidence, not a substitute for runtime or independent review of new behavior.

Selected GREEN manifest: WORKSPACE-UI, HIST-004-A late-response journey, HIST-003-A/
HIST-004-A pinned-browser-page journey, VAL-UI and VCH-UI. Passed source/oracle review,
actual themed360/768/1440 frames, frontend tests/build/lint, strict all-E2E types, scoped
Biome and final strict OpenSpec. Chart hidden-resize-return retained its canvas and
positive contained dimensions; account navigation reset selection and old results.

Unrun for this scope: full E2E/backend/API/PGprecision/upgrade/live-provider/security/
release suites; directory MPV-UI is unchanged and outside scoped styles. SimpleHIST and
separate account-switch preconditions are updated/typechecked but not part of selected
GREEN; WORKSPACE provides bounded runtime account-navigation evidence. No production/
preview rollout or original-project consolidation is authorized by this slice.

## Archive checkpoint

OpenSpec1.2.0 `archive redesign-account-analytics --yes` exited0 and created
`2026-09-27-redesign-account-analytics`, adding3requirements. It reported5/6tasks:
only3.2 (archive/comparison/integration/cleanup itself) remained in progress, with no
functional or review work skipped. Generated Purpose was replaced with a concrete scope.
Post-archive comparison passes:42old canonical files byte-identical,3new blocks match
exactly,43canonical specs and no active changes. Evidence:
`...-archive.log`, `/private/tmp/capital-analytics-canonical-comparison.log`.
Integration/cleanup bookkeeping is completed after those actions, not prechecked.
