# Settings workbench verification

Status: specification and baseline complete; acceptance first. Whole-refactor goal remains active.

Base628581c, isolated rootbranchrefactor/redesign-settings-workbench;41canonical specs/no prior active change. Read AGENTS, continuity/targetredesignamendment, Settings/switch/FX source and daily-display-fx spec/DFX-UI, current manually gated CI/CD. Inventory/ownership in design.md. No backend/API/auth/schema/dependency/pipeline changes planned.

Baseline frontend118tests/21files PASS; actual duration from `/private/tmp/capital-settings-workbench-baseline.log`. Existing passing characterization preserved for pure layout changes. New selection/associated-guidance behavior requires actual predecessor RED before product edits. Predecessor FEsha256:0ffbe36b31fa94fe3a8e931b2f6bdd4e53f2065916d12069ffb75245d6a26c3f; unchanged BEsha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2.

Required manifest: existing DFX-UI extended for SETTINGS-UX-001-A/002-A/B/003-A; actual HTTPS/password/MFA/backend/PostgreSQL22migrations and release-artifact/proxy gates. Only external providers use fixtures. Original exact123.45→111.105/11125.314, delayed amount rejection, failedcollection last-good200→180/18024, financial fingerprints and exact provider counts stay. Conditional activation may read saved FX; before firstFX activation general/preferences must not read/collect it. Legacy currency list reads stay allowed. All general/FX light/dark360/768/1440 actualframes and independent source/oracle/productreview required.

Local gates: frontend118characterization/build/lint, strict all-E2E types, scoped Biome, production audit, strict OpenSpec. Full backend/E2E/API/PGprecision suites, populated upgrades, live providers, scanners/DAST, hostedCI, production/preview rollout and consolidation are not repeated/claimed for this frontend-only slice. No own backend/auth mocks or oracle weakening.
