# Settings workbench verification

Status: archived and integrated; all six slice tasks complete. Whole-refactor goal remains active.

Base628581c, isolated rootbranchrefactor/redesign-settings-workbench;41canonical specs/no prior active change. Read AGENTS, continuity/targetredesignamendment, Settings/switch/FX source and daily-display-fx spec/DFX-UI, current manually gated CI/CD. Inventory/ownership in design.md. No backend/API/auth/schema/dependency/pipeline changes planned.

Baseline frontend118tests/21files PASS3.59s; actual evidence in `/private/tmp/capital-settings-workbench-baseline.log`. Existing passing characterization preserved for pure layout changes. New selection/associated-guidance behavior requires actual predecessor RED before product edits. Predecessor FEsha256:0ffbe36b31fa94fe3a8e931b2f6bdd4e53f2065916d12069ffb75245d6a26c3f; unchanged BEsha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2.

Required manifest: existing DFX-UI extended for SETTINGS-UX-001-A/002-A/B/003-A; actual HTTPS/password/MFA/backend/PostgreSQL22migrations and release-artifact/proxy gates. Only external providers use fixtures. Original exact123.45→111.105/11125.314, delayed amount rejection, failedcollection last-good200→180/18024, financial fingerprints and exact provider counts stay. Conditional activation may read saved FX; before firstFX activation general/preferences must not read/collect it. Legacy currency list reads stay allowed. All general/FX light/dark360/768/1440 actualframes and independent source/oracle/productreview required.

Local gates: frontend118characterization/build/lint, strict all-E2E types, scoped Biome, production audit, strict OpenSpec. Full backend/E2E/API/PGprecision suites, populated upgrades, live providers, scanners/DAST, hostedCI, production/preview rollout and consolidation are not repeated/claimed for this frontend-only slice. No own backend/auth mocks or oracle weakening.

Independent preimplementation review found no blockers. It confirms that section activation may read saved data, conditional unmount/remount resets local FX amount by existing design, and repeated active-button activation must not remount. Keep exact financial/provider/last-good gates and original controller generations; optional switch IDs only forward attributes. Theme changes for FX captures must preserve the mounted panel rather than navigate back to General.

Production audit exited0:2existing moderate findings/nohighcritical, unchanged dependencies/lock; `/private/tmp/capital-settings-workbench-audit.log`. Strict42items pass (41canonical plus change), `...-specs.log`. Actual predecessor image IDs checked; disposable E2E container inventory empty. No product edits yet.

## Acceptance-first RED

Sol acceptancee9b23c83 integrated607a992; root and separate reviewer independently inspected its unchanged financial/provider oracles. Scoped Biome and strict all-E2E types passed in acceptance worktree. Reviewer requested a small timing robustness correction for the new active-button no-refetch observation window; it is being corrected without changing the RED oracle.

`caffeinate -is node /private/tmp/capital-settings-workbench-browser.cjs red` exited1 on predecessorFE0ffbe36b. Actual HTTPS/password/MFA/PostgreSQL22migrations and release-artifact/proxy checks passed; bounded10s missing group `Разделы настроек` was the intended failure. Product edits began only after this terminal result. Log `...-red.log`, copied `...-red-artifacts`; cleanup completed.

## Candidate and local gates

RootTSX8bbc194 adds selected native sections/associated labels, separate saved-read/collect areas and result-before-metadata layout. LunaCSS5f31f98 integrated7d1d4a0; rootfollowup6a65642 keeps amount and actions in one column within nested content widths, bounds the heading and removes scoped select transitions. Optional switch IDs only forward DOM attributes. No economic/controller changes. Acceptance timing followup8a6fb431 integratedcc632da attaches the listener before click and retains it through a full500ms after the action; independent review confirms the correction and retained original oracles.

- `/private/tmp/capital-settings-workbench-control-audit.cjs` PASS14control signatures plus module/pre-render controller logic across4TSXfiles; `...-controls.log`. Type attributes are excluded to permit explicit Settings button types; independent source review separately confirms original FX input/button types and conditional mounting.
- Frontend118tests/21files PASS5.33s; `...-unit.log`.
- Frontend build PASS1.06s, existing >500kB bundle warning; `...-build.log`.
- Frontend lint PASS27existing warnings; `...-lint.log`.
- Strict all-E2E TypeScript from backend PASS: `pnpm exec tsc --noEmit --strict --target ES2022 --module commonjs --moduleResolution node --esModuleInterop --skipLibCheck ../tests/e2e/*.ts`; `...-types.log`.
- Scoped Biome7files PASS and diff check PASS; `...-style.log`.
- Frontend image build PASS; `...-image.log`. CandidateFEsha256:9f53b3f46a042d5759c91956e86295563186c0124826f34bc7b8230e30279571; unchangedBEdd90a8c5. RealGREEN subsequently passed as recorded below.

## Actual GREEN

`caffeinate -is node /private/tmp/capital-settings-workbench-browser.cjs green` exited0 on candidateFE9f53b3f4/unchangedBEdd90a8c5. Selected existing DFX-UI passed17.2s, final1/1 in17.9s, one Chromium worker/zero retries. Log `/private/tmp/capital-settings-workbench-green.log`. Fresh synthetic PostgreSQL22migrations, actual HTTPS/password/MFA and release-artifact/proxy gates passed; only external providers use fixtures. Harness cleanup completed.

Original USD123.45→EUR111.105/RUB11125.314, attribution/publication/fetch times, initial unavailable/no-provider read, exact explicit-only provider counts, real delayed old123.45 response rejection after editing200, and failed-collection last-good180/18024/stale context pass with unchanged financial fingerprints. New native section selection/focus, language EN/RU persistence, real light/dark/system theme controls, no FX reads before activation, post-action500ms no-refetch observation and associated amount guidance pass. Final actual provider count remains exactly two calls.

All light/dark360/768/1440 assertions pass: no page overflow or horizontally hidden selector,44px main controls and actual keyboard-contained table scrolling. Eighteen actual full-viewport frames are copied under `/private/tmp/capital-settings-workbench-green-artifacts`:6general and12FX. Root additionally viewed general-light1440, FX-dark360-1 and FX-light768-2. Captures cover normal general preferences and fresh123.45 conversion, not every unavailable/error/stale/disabled state. Their behavior has retained runtime assertions; no complete accessibility/cross-browser/whole-product approval is claimed.

Separate general product visual review inspected all6frames, no blockers: [report](general-visual-review.md). Reviewer authored acceptance but not product; independent source/oracle/FX review is separate.

Pre-archive strict42items pass (41canonical plus change), `...-specs-final-active.log`; diff check passes. E2E Docker container/network label inventories empty. Preview remains stopped45hours with its durable volume and originalFEsha256:7eff01d148e8f286c025655ffa0dd88cfa842fc051d9dd9240318c11cc60768c preserved. Main remains628581c with sole owner Nginx edit: mode0644,size1348,SHA256115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432; lockSHA2566a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d unchanged. No owner data access, production/preview rollout, push or original-folder cleanup.

Independent source/oracle and all12FX-frame review found no blocking findings: [report](review.md). This reviewer authored neither product nor acceptance. The narrow-table frames are at the left edge; full rightmost exact values at360/768 are established by DOM assertions and keyboard scroll evidence, not claimed from those static frames alone. No mandatory correction remains. All five product/verification tasks complete; final task3.2 intentionally includes archive/comparison/integration/cleanup.

## Archive

OpenSpec1.2.0 `openspec archive redesign-settings-workbench --yes` exited0 and created `2026-09-27-redesign-settings-workbench`, synchronizing3requirements. CLI warned5/6tasks because task3.2 includes archive/comparison/integration/cleanup, not unfinished product verification. It stays pending until that procedure completes. Log `/private/tmp/capital-settings-workbench-archive.log`.

All41previous canonical files remain byte-identical to628581c; all3newrequirement blocks match archived delta after blank-line normalization. Generated Purpose placeholder and EOF blank line replaced with the concrete purpose and normal file ending. Strict42canonical specs pass; active changes empty. Logs `...-canonical.log` and `...-specs-archived.log`.

Product/archive d69ea20 fast-forward integrated into refactor/brownfield-baseline after guarding starting628581c HEAD, sole owner Nginx edit and protected hashes. Only seven exact temporary dependency links in integration/QA/CSS worktrees were unlinked after validating all targets; primary dependencies and all source worktrees remain. Task3.2 is complete. Final bookkeeping changes documentation only, with no additional product test run or whole-redesign completion claim.
