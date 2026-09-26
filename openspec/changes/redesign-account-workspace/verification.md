# Account workspace verification — 2026-09-26

## Scope and baseline

Isolated worktree `capital-tracker-account-workspace`, branch `refactor/account-workspace`,
from5099690. Existing deployment remains separate FE/BE images, actual deployment
proxy rendered for synthetic HTTPS and explicit migrations. No replacement pipeline,
dependency, backend, auth, schema, provider or data change. No production or preview
deployment. Root owns shared Docker. Agent review remains quota-blocked; no retries,
paid routing or independent-review claim.

Installed OpenSpec1.2.0 was used: new change, status/instructions for proposal,
design/specs/tasks, instructions apply, strict validate. There is no verify command.
All artifacts precede product edits. Canonical specs remain unchanged until archive.

Protected integration Nginx: mode0644,size1348,SHA256
`115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432`.
Lock SHA256 `6a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d`.
The worktree has the tracked Nginx version; the frontend image uses the retained
deploy/container-nginx.conf. The owner edit is never copied/staged/replaced.

## Acceptance mapping and retained invariants

- WORKSPACE-001/002: `AccountWorkspace.test.tsx` checks labelled controlled sections
  and the same stateful editor node/value after switching, without API/auth stubs.
  WORKSPACE-UI uses real password/MFA/HTTP/PostgreSQL, keyboard selection, actual hidden
  controls and360/768/1440 screenshots/overflow checks. Same trade-input/result nodes,
  exact0.123456789012345678 draft,100 historical cost, unchanged request counts,
  real201 committed-response loss, explicit identical200 retry, SQL single version,
  exact112.35 remaining cost after reload and a separate account with blank state.
  Real route.fetch observes a committed response before aborting delivery; no own API
  response is fabricated. Hidden analysis still invalidates on actual journal revision.
- WORKSPACE-003: retained OPEN-001-A/OPEN-002-A keeps exact large/fractional amounts,
  unknown vs zero, actual in-flight write lock, restart and opening history. Retained
  CARRY-001-A/CARRY-005-A keeps explicit immutable baseline consent, preview/request
  contents, exact300 cost and adds saved initial snapshot2/300/revision1/time checks
  after initialization. It retains original openings and private prior-state oracles.
- HIST-004-A journey retains late-response rejection and unsaved correction120 with
  exact historical1/100 and no implicit accounting commands. Three TRADE-006-D cases
  retain original correction retry after409/review,403 denial, and ambiguous journal
  initialization blocking opening replacement. Their financial/private/provider and
  request identity assertions are preserved.

Only now-required section entry actions and the honest opening-snapshot label change
in other existing browser cases. Analytical tests that inspect a hidden draft use
includeHidden on its form scope, retaining the exact value assertion; visible actions
still explicitly select their section. No financial assertion is weakened/deleted.

## Actual RED and local checks

Evidence prefix `/private/tmp/capital-workspace-`:

- `unit-baseline.log`:114 tests/19files PASS3.30s before product edits.
- `browser-red.log`: actual predecessor FE340b653f, unchanged BEdd90a8c5, synthetic
  migrations/CLI owner bootstrap and HTTPS artifact checks pass. WORKSPACE-UI then
  genuinely fails: historical instant expected hidden, received visible. Exit1,
  screenshot/trace retained in `browser-red-artifacts`. No artificial financial failure.
- `unit-green.log`:116tests/20files PASS3.36s, including two new presentation checks.
- `build.log`, `build-final.log`: exit0; existing >500kB bundle warning remains.
- `lint.log`, `lint-final.log`: exit0,27existing warnings; scoped source formatting passes.
- `e2e-types.log`: backend cwd strict standalone tsc check of all E2E TypeScript passes.
- `specs.log`: strict OpenSpec32/32 PASS. `production-audit.log`: exit0 at required
  high/critical threshold, two moderate findings remain visible. No packages changed.

Initial command-location mistakes (root biome binary and nonexistent E2E tsconfig,
then shell glob outside backend cwd) failed; they are not counted as successful
checks. Corrected commands use the installed frontend Biome and existing backend tsc
options documented in the preceding directory verification.

## Browser attempts and final verification

`caffeinate -is node /private/tmp/capital-workspace-browser.cjs green` selected7 cases
(the TRADE-006-D filter selected three regressions). Initial FE
`sha256:acabbc049376f9680ee6d9efd7e9e8bc334c8ead8fdc7b0967ee413b527a2d20`;
unchanged backend `sha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2`.
Five passed, two failed, total3.5m. The pre-controller403 test mistakenly navigated to
setup before correcting a trade; the ambiguous-initialization case lacked its setup
entry. Both were test-navigation mistakes and were corrected without changing their
assertions. This failed attempt remains in `browser-green.log` and
`browser-green-artifacts`; it is not claimed as a passing suite.

Root inspected initial responsive screenshots and moved opening scope/revision into
setup and the journal explanation into operations; the shared journal title/refresh
now form a compact row before section controls. The same recovery/errors stay global.
Final frontend build `image-final.log`:
`sha256:7051d24c4bbfe691e127ce2e6d7a448cc2f8f8b2aceecc0b9d6f2de939c59839`.
`caffeinate -is node /private/tmp/capital-workspace-final.cjs green` exited0,
**3/3 PASS39.8s**, one worker/zero retries: WORKSPACE-UI12.7s, pre-controller40313.5s,
ambiguous initialization12.9s. Evidence `final-green.log` and `final-green-artifacts`.
Root inspected final operations1440/analytics360/setup768 screenshots; all three
sections have screenshots at each required width. Exact draft/results and actual
committed-response replay still pass after the compact-header adjustment.

One additional risk-based retained check was selected because Chart.js now lives in
a hidden mounted section: `/private/tmp/capital-workspace-chart.cjs green` exited0,
**VCH-UI1/1 PASS14.2s** on the final image, `chart-green.log`. It retains the real
0/100/null/150 series, gap-only state, explicit zero-price refresh, late-period rejection
and unsaved trade draft110 through section changes. No maximum-period expansion.
Together these attempts give eight distinct selected passing browser cases; there
was no full-suite run and no claim that the failed seven-case attempt passed.

Final strict E2E types pass (`e2e-types-final.log`). Each harness cleaned its synthetic
stack in finally. Final read-only Docker inventory showed no E2E containers/networks;
preview volume `capital-tracker-preview_preview_data` exists, original stopped preview
containers remain and frontend preview tag is unchanged at
`sha256:7eff01d148e8f286c025655ffa0dd88cfa842fc051d9dd9240318c11cc60768c`.
Protected owner Nginx mode/size/hash and lock hash above match the final inspection.

## Review and limits

Root source inspection confirms original accounting callbacks, keys, eligibility,
cross-editor locks and retry objects remain with their owners. Section selection
lives in ManualAccountDetail, checked against account identity, so ordinary selection
does not remount editors and an opening-revision journal remount preserves the section.
This is integration inspection, not independent review. Task3.1 and archive3.3 remain
unchecked until independent review passes. No canonical spec synchronization yet.
An exact source comparison against5099690 confirms the state/effect/callback blocks
between existing accounting state initialization and render are byte-for-byte
unchanged in both ManualAccountDetail and TradeJournal. Three temporary worktree
dependency symlinks were removed after checks; actual installed dependencies remain.

Unrun: full E2E/browser matrix, unrelated backend/security/release/hostedCI gates,
complete frontend redesign and owner visual acceptance, expanded chart periods.
No new full-migration, whole-portfolio, production-readiness or preview-update claim.
