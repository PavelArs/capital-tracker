# Settings workbench verification

Status: specification and baseline complete; acceptance first. Whole-refactor goal remains active.

Base628581c, isolated rootbranchrefactor/redesign-settings-workbench;41canonical specs/no prior active change. Read AGENTS, continuity/targetredesignamendment, Settings/switch/FX source and daily-display-fx spec/DFX-UI, current manually gated CI/CD. Inventory/ownership in design.md. No backend/API/auth/schema/dependency/pipeline changes planned.

Baseline frontend118tests/21files PASS3.59s; actual evidence in `/private/tmp/capital-settings-workbench-baseline.log`. Existing passing characterization preserved for pure layout changes. New selection/associated-guidance behavior requires actual predecessor RED before product edits. Predecessor FEsha256:0ffbe36b31fa94fe3a8e931b2f6bdd4e53f2065916d12069ffb75245d6a26c3f; unchanged BEsha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2.

Required manifest: existing DFX-UI extended for SETTINGS-UX-001-A/002-A/B/003-A; actual HTTPS/password/MFA/backend/PostgreSQL22migrations and release-artifact/proxy gates. Only external providers use fixtures. Original exact123.45→111.105/11125.314, delayed amount rejection, failedcollection last-good200→180/18024, financial fingerprints and exact provider counts stay. Conditional activation may read saved FX; before firstFX activation general/preferences must not read/collect it. Legacy currency list reads stay allowed. All general/FX light/dark360/768/1440 actualframes and independent source/oracle/productreview required.

Local gates: frontend118characterization/build/lint, strict all-E2E types, scoped Biome, production audit, strict OpenSpec. Full backend/E2E/API/PGprecision suites, populated upgrades, live providers, scanners/DAST, hostedCI, production/preview rollout and consolidation are not repeated/claimed for this frontend-only slice. No own backend/auth mocks or oracle weakening.

Independent preimplementation review found no blockers. It confirms that section activation may read saved data, conditional unmount/remount resets local FX amount by existing design, and repeated active-button activation must not remount. Keep exact financial/provider/last-good gates and original controller generations; optional switch IDs only forward attributes. Theme changes for FX captures must preserve the mounted panel rather than navigate back to General.

Production audit exited0:2existing moderate findings/nohighcritical, unchanged dependencies/lock; `/private/tmp/capital-settings-workbench-audit.log`. Strict42items pass (41canonical plus change), `...-specs.log`. Actual predecessor image IDs checked; disposable E2E container inventory empty. No product edits yet.

## Acceptance-first RED

Sol acceptancee9b23c83 integrated607a992; root and separate reviewer independently inspected its unchanged financial/provider oracles. Scoped Biome and strict all-E2E types passed in acceptance worktree. Reviewer requested a small timing robustness correction for the new active-button no-refetch observation window; it is being corrected without changing the RED oracle.

`caffeinate -is node /private/tmp/capital-settings-workbench-browser.cjs red` exited1 on predecessorFE0ffbe36b. Actual HTTPS/password/MFA/PostgreSQL22migrations and release-artifact/proxy checks passed; bounded10s missing group `Разделы настроек` was the intended failure. Product edits began only after this terminal result. Log `...-red.log`, copied `...-red-artifacts`; cleanup completed.
