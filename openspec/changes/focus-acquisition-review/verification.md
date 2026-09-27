# Acquisition review focus verification

Status: product/source/oracle/visual review and selected runtime verification pass;
archive/integration procedure remains pending.

Base2616db4, isolated rootbranch refactor/focus-acquisition-review;42canonical specs.
Scope/inventory/ownership in design.md. CI/CD inspected; production stays manually
gated and unchanged. Owner Nginx, dependency lock and durable preview are protected.
No backend, schema, authentication, dependency or provider changes.

Frontend baseline118tests/21files PASS6.66s, preserving characterization:
`/private/tmp/capital-acquisition-focus-baseline.log`. Production audit exited0 with
the existing2moderate findings/nohighcritical; `...-audit.log`. Strict OpenSpec43items
(42canonical plus active change) PASS; `...-specs.log`.

## Acceptance-first RED

Sol authored acceptance f4ee65f and followup3410381 in capital-test-acquisition-focus;
integrated as fe5f713/e81ecd8. Separate reviewer found no blocking oracle findings.
Original financial, exact retry, stale-review and final correction/void assertions
remain intact. New captures use actual system-theme media changes. Real history
responses use route.fetch, delayed delivery and finally-release/await/unroute.
Scoped Biome and strict all-E2E types passed before product edits.

`caffeinate -is node /private/tmp/capital-acquisition-focus-browser.cjs red` exited1:
both SWAP-UI and REWARD-UI reached the expected10s failure that the existing correction
opener remained focused. Each first asserts that behavior before requiring new markup.
This is the intended acceptance failure, not a fixture/setup failure.
Real HTTPS/password/MFA/backend/PostgreSQL22migrations and release-artifact/proxy gates
ran; only external providers used fixtures. Synthetic Docker cleanup completed.
Log `...-red.log`; artifacts `...-red-artifacts`.

Predecessor frontend sha256:9f53b3f46a042d5759c91956e86295563186c0124826f34bc7b8230e30279571;
unchanged backend sha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2.
Product edits started only after both terminal expected failures were inspected.

## Implementation and remaining gates

Root fcd3e00 adds swap action-only postcommit focus requests, editor region, history
heading/close and shared focus styles. Independent source review caught an undefined
CSS token before runtime; it was corrected to existing --primary-color-dark in that
commit. The temporary AST comparison initially flagged only multiline JSX indentation
inside the wrapped unchanged recovery prop; it now normalizes that indentation while
preserving expression/string/control comparisons. Luna Rewards92f9f2c integrated15d0ba2;
rootfollowupf18a1c7 aligned ref cleanup/scrolling and removed an extra state-reset render.
Independent review confirmed no remaining source/oracle finding, including that followup.

- AST comparison PASS all original module/pre-render logic and stage/cancel prefixes,
  plus19protected control/form/pagination signatures; `...-controls.log`.
- Final frontend118tests/21files PASS3.65s, `...-unit-final.log`. Initial candidate
  also passed118/21 in3.67s before the focus-only consistency followup.
- Final frontend build PASS1.07s, existing >500kB bundle warning; `...-build-final.log`.
- Frontend lint PASS27existing warnings; `...-lint.log`. Scoped Biome5files PASS,
  plus followupRewards file PASS; `...-style.log`. Diff check PASS.
- Strict all-E2E TypeScript PASS from backend cwd; `...-types.log`. The first command
  used root cwd and shell glob expansion failed before tsc; corrected cwd succeeded.
- Final image build PASS; `...-image-final.log`. Candidate frontend sha256:
  eedaddee6de4eb8719c7fe19d09400716a0d96ea994bef525c426ad99788a810;
  backend remains dd90a8c5. Superseded pre-followup image789b8978 is not GREEN evidence.

Broader backend/E2E/API/precision/upgrade/live-provider/security/release suites are
unrun for this frontend-only slice. No production/preview deployment or consolidation.

## Actual GREEN and visual evidence

`caffeinate -is node /private/tmp/capital-acquisition-focus-browser.cjs green` exited0
on candidateFEeedaddee6/unchangedBEdd90a8c5. WORKFLOW-UI16.0s, REWARD-UI17.5s and
SWAP-UI18.0s all passed; final3/3 in52.1s, Chromium/one worker/zero retries. Log
`/private/tmp/capital-acquisition-focus-green.log`. Fresh synthetic PostgreSQL22migrations,
actual HTTPS/password/MFA and release-artifact/proxy checks ran; only external providers
use fixtures. Backend/authentication are not mocked. Disposable cleanup completed.

New ENTRY-004/005 assertions pass: correction/void stage focus, fresh-review gate,
original blank-create cancel reset and enabled-origin return; genuine immutable
history responses, immediate heading focus, own exact unsaved23 and independent
trade draft preservation; pending close before delivery and no reopening/focus theft
after delivery. No POST, financial fingerprint or provider-count changes occur from
navigation. Existing exact committed-response-loss retry, zero/unknown/fee/category,
stale-review rejection and final correction/void assertions remain passing. Unchanged
WORKFLOW-UI retains separate workflows/drafts/CSV File/characterization.

Nineteen new actual viewport frames are copied under `...-green-artifacts`:
11swap-focus and8reward-focus files, at360dark/1440light covering correction/void/history.
These are viewport-height segments of the full relevant form/history, not fabricated
mockups. New captures exercise the real media theme listener and assert no overflow.
Older entry/workflow captures generated by retained tests are not claimed as newly
independently reviewed full-matrix evidence.

Independent source/oracle reviewer additionally viewed all11swap frames: no blocking
finding. Minor nonblocking outline spacing near the following record-count line is
tracked for whole-screen polish; text remains readable. No mandatory correction remains.

Separate product visual reviewer inspected all8reward frames without blockers. It
authored acceptance, not product; source/oracle review remains independent. Root viewed
swap-correction-dark360-1 and reward-history-light1440-1. Exact inspected lists/limits
are recorded in review.md. Static frames do not establish focus ordering, late-read
correctness, contrast ratios or whole-product accessibility/UX approval.

Final active strict43items PASS; `...-specs-final-active.log`. Docker E2E container/
network inventories empty. Preview remains stopped45hours with originalFE7eff01d1
and capital-tracker-preview_preview_data preserved. Main remains2616db4 with sole
owner Nginx edit: mode0644,size1348,SHA256115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432;
lockSHA2566a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d.
