# Manual-price workbench verification

Status: archived and integrated; all six slice tasks complete. Whole-refactor goal remains active.

Based4dd415, root refactor/redesign-manual-price-workbench. Read AGENTS, target brief/redesign amendment, current continuity, manual-price spec/controller/API/tests and current manually gated CI/CD. Inventory and file ownership are in design.md. No backend/API/auth/schema/dependency/pipeline changes planned.

Baseline frontend118tests/21files pass3.92s on Node22.23.2; `/private/tmp/capital-price-workbench-baseline.log`. Actual OpenSpec1.2.0 new/status/instructions workflow used; strict41items pass (40canonical plus this change). Predecessor FEsha256:78436d00c6a36f0109abe0505dbff20fc21d8fe67642cc605b79d3dc51b3fa41; unchanged BEsha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2.

Required manifest: independently extended existing PRICE-UI/PRICE-RECOVERY covers PRICE-UX-001-A/002-A/B/003-A/B with actual HTTPS/password/MFA/backend/PostgreSQL22migrations and release/proxy artifact gates. Providers only use fixtures. Retain exact100/110, original uncertain command replay, accepted-refresh locks, late instrument reads, void/history/reload, old-row/admission/provider assertions. New delayed history delivery uses real upstream reads. No new browser cases. Required local frontend tests/build/lint, strict all-E2E types, scoped Biome, production audit, strict OpenSpec and independent product/oracle/actual viewport review.

Full backend/E2E/API/PG precision suites, upgrades, live providers, scanners/DAST, hostedCI, production/preview deployment and consolidation are not repeated or claimed for this page-only slice. Existing passing characterization is preserved for pure layout changes; new guidance/disclosure/navigation first fails on predecessor.

## Acceptance-first RED

Sol acceptance9263a91 integratedc7937ab; root and separate reviewer independently inspected the test changes and retained financial/recovery assertions. Scoped Biome and strict all-E2E TypeScript passed in its worktree. New history delay asserts actual200 and exact110/100 revisions before holding the upstream response, releases/awaits handlers in finally and never fabricates application/auth data.

`caffeinate -is node /private/tmp/capital-price-workbench-browser.cjs red` exited1 on predecessorFE78436d00. Actual HTTPS/password/MFA/PostgreSQL22 migrations and release/proxy artifact checks passed. The intended bounded10s visibility failure was the absent `Правила ручных цен` native summary. Product files remained unchanged until that terminal result. Log `/private/tmp/capital-price-workbench-red.log` and copied `...-red-artifacts`; harness cleanup completed.

Independent preimplementation review confirms key checks: focus only from explicit actions, invalidate close before restoring origin, keep separate opener refs across pagination, preserve drafts/locks on cancellation, retain semantic td and associated field labels. Disconnected/disabled-origin fallback is a final source-review check; the selected runtime journey covers live-origin restoration.

Production dependency gate exited0 with2existing moderate/nohighcritical; `/private/tmp/capital-price-workbench-audit.log`. No dependency/lock change.

## Candidate implementation and local gates

RootTSX62c1eb2, LunaCSSeb5a3c6 integrated0716ee4 and root followup366b1b3 add focused entry, associated exact guidance, native rules, event-only void/history focus and semantic contained tables. Root followup prioritizes Save, keeps responsive field columns container-aware and corrects checkbox specificity. Original financial/recovery/read controllers remain; no backend/API/auth/schema/dependency/pipeline changes.

- Structural audit `/private/tmp/capital-price-workbench-control-audit.cjs` PASS: four form signatures,20 financial/read/recovery definitions and six save/confirm/load guards/callbacks unchanged; `...-controls.log`. Source review separately covers focus, mounting, labels and result branches.
- Frontend118tests/21files PASS3.95s; `...-unit.log`.
- Frontend build PASS1.03s with existing >500kB warning; `...-build.log`.
- Frontend lint PASS with27existing warnings; `...-lint.log`.
- Strict all-E2E TypeScript from backend PASS: `pnpm exec tsc --noEmit --strict --target ES2022 --module commonjs --moduleResolution node --esModuleInterop --skipLibCheck ../tests/e2e/*.ts`; `...-types.log`.
- Scoped per-package Biome3files PASS; `...-style.log`.
- Frontend image build PASS; `...-image.log`. Candidate FEsha256:0ffbe36b31fa94fe3a8e931b2f6bdd4e53f2065916d12069ffb75245d6a26c3f; backenddd90a8c5 unchanged.

## Actual GREEN and independent review

`caffeinate -is node /private/tmp/capital-price-workbench-browser.cjs green` exited0 on candidateFE0ffbe36b and unchangedBEdd90a8c5. Selected existing PRICE-UI/PRICE-RECOVERY passed16.1s, final1/1 in16.7s, one Chromium worker/zero retries. Log `/private/tmp/capital-price-workbench-green.log`. Fresh synthetic PostgreSQL22migrations, actual HTTPS/password/MFA and release-artifact/proxy checks passed; only external providers use fixtures. Harness finally cleanup completed.

Retained exact100/110 and immutable revisions, identical-body replay after actual committed response loss, accepted-correction refresh lock, stale instrument-read rejection, reviewed void/history/reload, original accounting rows, admission deltas and provider equality pass. New staging/cancel/close preserve the unsaved115/date draft and price rows without POST. Actual delayed upstream history preserves focus and cannot reopen a closed panel. Native keyboard rules disclosure makes no requests. No financial/security assertion was weakened.

All light/dark360/768/1440 viewport assertions pass: no page overflow,44px main controls, captioned named focusable semantic table and actual narrow keyboard scrolling. Twenty-four actual viewport frames are copied under `/private/tmp/capital-price-workbench-green-artifacts`. Root additionally viewed dark360editor, light1440header and light768history. No screenshot masks or hidden skip-link changes.

Independent reviewer authored neither source nor acceptance; reviewed both plus actual RED/GREEN and all18header/book/history frames, no blockers: [report](review.md). Separate editor product review inspected all6editor frames, no blockers: [report](editor-visual-review.md). That reviewer authored acceptance but not product. Connected/enabled opener restoration has runtime coverage; disconnected/disabled fallback is source-reviewed only. Captures show normal corrected-history/draft states, not every error/unknown/zero/void state. Narrow native closed selects truncate long option labels; full UUID/payload are retained, native popup readability is not established. Full accessibility/cross-browser/whole-product approval is not claimed.

Pre-archive strict OpenSpec validation PASS41items (40canonical plus change); `...-specs.log`. Diff check passes. Labeled E2E Docker container/network inventories are empty. Durable preview remains stopped44hours, its volume exists and FEsha256:7eff01d148e8f286c025655ffa0dd88cfa842fc051d9dd9240318c11cc60768c is unchanged. Main remainsd4dd415 with only the owner Nginx edit: mode0644,size1348,SHA256115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432; lockSHA2566a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d unchanged. No owner database access, production/preview deployment, push or original-folder cleanup.

## Archive

OpenSpec1.2.0 `openspec archive redesign-manual-price-workbench --yes` exited0 and created `2026-09-27-redesign-manual-price-workbench`, synchronizing3requirements. The CLI warned5/6tasks because final task3.2 includes archive/comparison/integration; required product checks were complete. Its checkbox remains pending until that procedure finishes. Log `/private/tmp/capital-price-workbench-archive.log`.

All40previous canonical files remain byte-identical tod4dd415; all3new requirement blocks match the archived delta after blank-line normalization. The first local comparison script failed because its heading regex greedily consumed multiple blocks; correcting that script's heading match established the three-block equality without editing requirement text. Generated Purpose placeholder replaced with the actual capability purpose. Strict41canonical specs pass; active changes are empty. Logs `...-canonical.log` and `...-specs-archived.log`.

Product/archive dc5aada fast-forward integrated into refactor/brownfield-baseline after guarding startingd4dd415 HEAD, sole owner Nginx edit and protected hashes. Seven exact temporary dependency links in integration/QA/CSS worktrees were unlinked after validating all targets; primary dependencies and all source worktrees remain. Task3.2 is now complete. The first staged diff check flagged the generated canonical spec's extra EOF blank line; final bookkeeping removes that blank line and repeats the diff/spec checks. No requirement text or product changes follow the reviewed candidate. No additional product test run or whole-redesign completion is claimed.

Final diff check and strict41canonical specs pass after EOF cleanup; canonical comparison still passes. Log `...-specs-final.log`.
