# Manual-price workbench verification

Status: actual predecessor RED observed; product implementation under review. Whole-refactor goal remains active.

Based4dd415, root refactor/redesign-manual-price-workbench. Read AGENTS, target brief/redesign amendment, current continuity, manual-price spec/controller/API/tests and current manually gated CI/CD. Inventory and file ownership are in design.md. No backend/API/auth/schema/dependency/pipeline changes planned.

Baseline frontend118tests/21files pass3.92s on Node22.23.2; `/private/tmp/capital-price-workbench-baseline.log`. Actual OpenSpec1.2.0 new/status/instructions workflow used; strict41items pass (40canonical plus this change). Predecessor FEsha256:78436d00c6a36f0109abe0505dbff20fc21d8fe67642cc605b79d3dc51b3fa41; unchanged BEsha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2.

Required manifest: independently extended existing PRICE-UI/PRICE-RECOVERY covers PRICE-UX-001-A/002-A/B/003-A/B with actual HTTPS/password/MFA/backend/PostgreSQL22migrations and release/proxy artifact gates. Providers only use fixtures. Retain exact100/110, original uncertain command replay, accepted-refresh locks, late instrument reads, void/history/reload, old-row/admission/provider assertions. New delayed history delivery uses real upstream reads. No new browser cases. Required local frontend tests/build/lint, strict all-E2E types, scoped Biome, production audit, strict OpenSpec and independent product/oracle/actual viewport review.

Full backend/E2E/API/PG precision suites, upgrades, live providers, scanners/DAST, hostedCI, production/preview deployment and consolidation are not repeated or claimed for this page-only slice. Existing passing characterization is preserved for pure layout changes; new guidance/disclosure/navigation first fails on predecessor.

## Acceptance-first RED

Sol acceptance9263a91 integratedc7937ab; root and separate reviewer independently inspected the test changes and retained financial/recovery assertions. Scoped Biome and strict all-E2E TypeScript passed in its worktree. New history delay asserts actual200 and exact110/100 revisions before holding the upstream response, releases/awaits handlers in finally and never fabricates application/auth data.

`caffeinate -is node /private/tmp/capital-price-workbench-browser.cjs red` exited1 on predecessorFE78436d00. Actual HTTPS/password/MFA/PostgreSQL22 migrations and release/proxy artifact checks passed. The intended bounded10s visibility failure was the absent `Правила ручных цен` native summary. Product files remained unchanged until that terminal result. Log `/private/tmp/capital-price-workbench-red.log` and copied `...-red-artifacts`; harness cleanup completed.

Independent preimplementation review confirms key checks: focus only from explicit actions, invalidate close before restoring origin, keep separate opener refs across pagination, preserve drafts/locks on cancellation, retain semantic td and associated field labels. Disconnected/disabled-origin fallback is a final source-review check; the selected runtime journey covers live-origin restoration.

Production dependency gate exited0 with2existing moderate/nohighcritical; `/private/tmp/capital-price-workbench-audit.log`. No dependency/lock change.
