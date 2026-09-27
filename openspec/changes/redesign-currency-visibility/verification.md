# Currency visibility verification

Status: specified and independently reviewed; genuine predecessor RED confirmed before
product changes. Implementation follows; no GREEN yet. Whole product/redesign remains incomplete.

Base1fd044f,43canonical specs. Actual proposal/status/instructions(proposal/design/specs/
tasks/apply) used installed OpenSpec1.2.0; strict44items PASS. Root main Nginx remains
untouched. Source/API/schema/caller and CI/CD audit plus inventory are in design.md.

Baseline frontend118tests/21files PASS3.45s, `/private/tmp/capital-currency-workbench-baseline.log`.
Initial required dependency audit failed sandbox DNS (ENOTFOUND), not advisory success:
`...-audit.log`. Authorized read-only retry exited0 with2existingmoderate/nohighcritical,
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
actual360/768/1440light/dark frames required before archive. Full backend/E2E/upgrade/
live-provider/security/release suites unrun; no production or preserved preview rollout.

## Genuine predecessor RED

At acceptance commit10e0097, CVIS-UI ran against unchanged FE6ee61c50/BEdd90a8c5,
actual22migrations, HTTPS/password/MFA/PostgreSQL. The hidden route.fetch returned200
with the genuine stored inactive row before deliberate response loss. Full preference
and financial/provider preservation assertions passed before the intended failure:
missing inline load-error alert in existing #settings-panel,10second assertion timeout.
One test failed22.0s; harness terminalexit1 and isolated Docker cleanup completed.
No product files had been changed. Log `/private/tmp/capital-currency-workbench-red.log`,
synthetic trace/screenshot in `...-red-artifacts`.

Sol's three independent coordinator unit scenarios are integrated from9204697. Their
pre-implementation import-resolution failure is narrower scaffolding evidence, not
an observed concurrency behavior failure. Real browser RED above is the ATDD gate.

## Candidate findings and correction

First candidate de5e3b6 / FEc8cef0be passed121frontend tests/22files3.95s, build/lint,
strict E2E types/scopedBiome and strict44spec items. Existing27lint warnings and Vite
large-chunk warning remain. Actual CVIS/DFX first GREEN failed2/2 (13.1s/21.8s):
- CVIS reached the actual hide request and got400: `isHidden should not be empty,
  isHidden must be a boolean value`. The old frontend wrapper omitted the field
  required by shared ToggleCurrencyDto. No preference commit/lost-command success
  was claimed. Sol corrected exact unit/E2E bodies; root observed2unit failures
  (4pass) before adding true/false to hide/show. Backend contract remains unchanged.
- DFX required the original legacy-scope sentence. Replacing that copy was an
  unintended retained-journey regression. Restore the exact original sentence in
  the manager's visible scope and keep the entire DFX test unchanged.

Independent reviewer confirmed both fixes preserve rather than relax the contract.
Scoped wrapper/coordinator tests then passed9/9. Logs `...-dto-red.log`,
`...-dto-green.log`, `...-green.log`; first GREEN trace/screenshots in
`/private/tmp/capital-currency-workbench-green-artifacts`. Final runtime pending.
