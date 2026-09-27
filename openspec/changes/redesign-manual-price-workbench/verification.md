# Manual-price workbench verification

Status: specified; acceptance and implementation pending. Whole-refactor goal remains active.

Based4dd415, root refactor/redesign-manual-price-workbench. Read AGENTS, target brief/redesign amendment, current continuity, manual-price spec/controller/API/tests and current manually gated CI/CD. Inventory and file ownership are in design.md. No backend/API/auth/schema/dependency/pipeline changes planned.

Baseline frontend118tests/21files pass on Node22.23.2; `/private/tmp/capital-price-workbench-baseline.log`. Actual OpenSpec1.2.0 new/status/instructions workflow used. Predecessor FEsha256:78436d00c6a36f0109abe0505dbff20fc21d8fe67642cc605b79d3dc51b3fa41; unchanged BEsha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2.

Required manifest: independently extended existing PRICE-UI/PRICE-RECOVERY covers PRICE-UX-001-A/002-A/B/003-A/B with actual HTTPS/password/MFA/backend/PostgreSQL22migrations and release/proxy artifact gates. Providers only use fixtures. Retain exact100/110, original uncertain command replay, accepted-refresh locks, late instrument reads, void/history/reload, old-row/admission/provider assertions. New delayed history delivery uses real upstream reads. No new browser cases. Required local frontend tests/build/lint, strict all-E2E types, scoped Biome, production audit, strict OpenSpec and independent product/oracle/actual viewport review.

Full backend/E2E/API/PG precision suites, upgrades, live providers, scanners/DAST, hostedCI, production/preview deployment and consolidation are not repeated or claimed for this page-only slice. Existing passing characterization is preserved for pure layout changes; new guidance/disclosure/navigation first fails on predecessor.
