# Currency visibility verification

Status: implementation, required scoped verification and independent source/visual review
pass. Archive/integration procedure follows; whole product/redesign remains incomplete.

Base `1fd044f`, 43 canonical specs. Actual proposal/status/instructions(proposal/design/specs/
tasks/apply) used installed OpenSpec 1.2.0; strict 44 items PASS. Root main Nginx remains
untouched. Source/API/schema/caller and CI/CD audit plus inventory are in design.md.

Baseline frontend 118 tests / 21 files PASS in 3.45s, `/private/tmp/capital-currency-workbench-baseline.log`.
Initial required dependency audit failed sandbox DNS (ENOTFOUND), not advisory success:
`...-audit.log`. Authorized read-only retry exited0 with 2 existing moderate findings and no high/critical findings,
unchanged dependencies: `...-audit-final.log`.

Separate design review closed remount serialization, full preference-table isolation,
inactive/non-system semantics and delayed-focus gaps before product changes. Tiny shared
pending promise orders client HTTP requests across remount; no stronger server-lock or
unknown transport-outcome guarantee is claimed. Sol acceptance in separate worktree,
Luna scoped CSS after RED, root controllers/integration/Docker; independent gate review.

Required runtime manifest: new CVIS-UI and unchanged retained DFX-UI using actual HTTPS/
password/MFA/backend/PostgreSQL and external-provider fixtures only. Genuine backend
responses may be held/lost to simulate transport failure, never replaced with fake DTOs.
Local tests/build/lint/types/scopedBiome/audit/strictspecs, independent source/oracle and
actual 360/768/1440 light/dark frames required before archive. Full backend/E2E/upgrade/
live-provider/security/release suites unrun; no production or preserved preview rollout.

## Genuine predecessor RED

At acceptance commit `10e0097`, CVIS-UI ran against unchanged FE `6ee61c50` / BE `dd90a8c5`,
actual 22 migrations, HTTPS/password/MFA/PostgreSQL. The hidden route.fetch returned 200
with the genuine stored inactive row before deliberate response loss. Full preference
and financial/provider preservation assertions passed before the intended failure:
missing inline load-error alert in existing #settings-panel, 10-second assertion timeout.
One test failed in 22.0s; harness terminal exit 1 and isolated Docker cleanup completed.
No product files had been changed. Log `/private/tmp/capital-currency-workbench-red.log`,
synthetic trace/screenshot in `...-red-artifacts`.

Sol's three independent coordinator unit scenarios are integrated from `9204697`. Their
pre-implementation import-resolution failure is narrower scaffolding evidence, not
an observed concurrency behavior failure. Real browser RED above is the ATDD gate.

## Candidate findings and correction

First candidate `de5e3b6` / FE `c8cef0be` passed 121 frontend tests / 22 files in 3.95s, build/lint,
strict E2E types/scopedBiome and strict 44 spec items. Existing 27 lint warnings and Vite
large-chunk warning remain. Actual CVIS/DFX first GREEN failed 2/2 (13.1s/21.8s):
- CVIS reached the actual hide request and got 400: `isHidden should not be empty,
  isHidden must be a boolean value`. The old frontend wrapper omitted the field
  required by shared ToggleCurrencyDto. No preference commit/lost-command success
  was claimed. Sol corrected exact unit/E2E bodies; root observed 2 unit failures
  (4 passed) before adding true/false to hide/show. Backend contract remains unchanged.
- DFX required the original legacy-scope sentence. Replacing that copy was an
  unintended retained-journey regression. Restore the exact original sentence in
  the manager's visible scope and keep the entire DFX test unchanged.

Independent reviewer confirmed both fixes preserve rather than relax the contract.
Scoped wrapper/coordinator tests then passed 9/9. Logs `...-dto-red.log`,
`...-dto-green.log`, `...-green.log`; first GREEN trace/screenshots in
`/private/tmp/capital-currency-workbench-green-artifacts`. Both findings are corrected.

## Final scoped verification

Product `87cf954`; frontend sha256:7190d650fb98b2d77ad5e79272fccf6cb5e790ea8dcee355fca9d97ad9682a36,
unchanged backend sha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2.
These exact images were inspected in the real final runtime, not inferred from host code.

- CVIS-UI PASS in 21.0s: initial and later genuine response loss; retained paired lists;
  exact full stored identities/literal hostile label; native selected controls; actual
  committed hide plus lost response and explicit reconciliation; no command replay;
  show/persistence; held command across Settings remount with exactly one fresh read
  pair after settlement and no focus theft; inactive show remains absent from active
  catalogue; exact all-preference oracle preserves other rows. Five intended POSTs
  require the existing DTO booleans. Financial/provider/catalogue state stays unchanged.
- Retained DFX-UI byte-unchanged PASS in 16.0s: real Settings preference/navigation,
  explicit provider collection and exact saved conversion/late-result behavior.
- Combined 2/2 PASS in 37.7s, 1 worker, 0 retries; terminal exit 0, 22 migrations, actual password/
  MFA/HTTPS/Nginx/backend/PostgreSQL. No own API/authentication substitutes. Synthetic
  responses held/lost only after actual route.fetch. All 36 screenshots copied outside
  disposable worktrees: 18 currency and 18 Settings/FX at 360/768/1440 in light/dark.
- Frontend 121 tests / 22 files PASS in 3.95s before the API correction; relevant corrected
  wrapper/coordinator 9 tests / 2 files PASS in 571ms. Host build and lint pass, strict E2E
  types pass, final package-scopedBiome pass; corrected Docker build also passed tsc/
  Vite. Existing 27 lint and bundle/http2 deprecation warnings remain.
- Production dependency gate PASS with 2 existing moderate findings and no high/critical findings; no dependency
  diff. Strict OpenSpec 44 items PASS after final explicit DTO scenario update.

Logs `/private/tmp/capital-currency-workbench-final.log`, `...-image-final.log`,
`...-units.log`, `...-build.log`, `...-lint.log`, `...-types.log`, `...-dto-green.log`,
`...-style-final.log`, `...-specs-final.log`. Real final images/frames in
`/private/tmp/capital-currency-workbench-final-artifacts`. All 36 actual images and final source were independently approved; see [review.md](review.md).
No owner visual approval claimed.

Post-run read-only Docker checks found no capital-tracker-e2e containers/networks.
Preserved preview containers remain stopped for 47 hours, preview_data exists and original
FE `7eff01d1` tag/image remains. Main owner Nginx/lock hashes match CONTINUITY; no backend,
auth/schema/deployment change, production/preview rollout, push or owner-data access.
Full suites, historical upgrades, other browsers, live providers, security/release/
backup-restore and whole-redesign completion remain unrun/outside this bounded gate.


A final root-level Biome invocation failed because that workspace package does not
expose the binary (`...-e2e-style-final.log`). The correct frontend-package invocation
against the same E2E file passed (`...-e2e-style-package.log`); no source change needed.
The final procedural task remains unchecked until archive/comparison, guarded main
integration and temporary-worktree removal actually complete. All functional gates
and independent review are complete before archive.
