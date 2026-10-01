# Operation workflows verification — 2026-09-26

## Scope and baseline

Isolated worktree `capital-tracker-operation-workflows`, branch `refactor/operation-workflows`,
from3ad13f7. OpenSpec1.2.0 new/status/instructions proposal/design/specs/tasks/apply used
in dependency order, before product changes. No unsupported verify command or archive.
No backend/schema/auth/dependency/deployment changes; existing FE/BE Docker pipeline,
explicit migrations and synthetic HTTPS proxy retained. No production or preview update.

Evidence prefix `/private/tmp/capital-workflows-`. `baseline.log`:116tests/20files PASS3.38s.
Owner Nginx mode0644,size1348,SHA256
`115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432`;
lock SHA256 `6a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d`.
The worktree uses tracked Nginx; image builds retain deploy/container-nginx.conf.

## Acceptance and retained behavior

- WORKFLOW-001/002 unit tests verify one visible workflow, native labelled control
  association and the same editor nodes/exact values through selection. No API/auth stubs.
- WORKFLOW-UI uses real password/MFA/HTTPS/PostgreSQL: initially hidden secondary
  workflows, keyboard choice, exact independent0.123456789012345678 trade,
  3.000000000000000001 swap and2.000000000000000001 reward inputs; original unuploaded
  CSV File identity;360/768/1440 switching/screenshots/contained width; same editor
  nodes after account-section switches; no accounting GET/POST or business/provider
  state changes. WORKFLOW-003 uses actual shared trade history to reveal its original
  1/100 correction and exact identity/version void confirmation without submitting;
  cancellation preserves the separate reward draft.
- Retained SWAP-UI and REWARD-UI preserve their original exact null/zero/cost/income,
  category, revision, late-review, correction/void and independent-draft assertions;
  actual committed201 delivery loss, explicit same200 replay and SPA return remain.
- Retained CSV-006-B committed-confirm/expiry/MFA/SPA case preserves exact original
  command, SQL receipt, real401/recovery-factor use and replay. Added explicit switching
  to trades while CSV is unresolved proves the hidden import still blocks its save.
  Returning to CSV does not send another command.

Other affected tests only gain explicit workflow entry actions. Hidden independent
trade-value assertions use includeHidden on the same form scope, retaining exact
expected values. Visible actions explicitly select their workflow. No financial or
authentication oracle was removed or weakened.

## Actual RED, corrections and checks

- `browser-red.log`: predecessor frontend7051d24c, actual migrations/owner bootstrap/
  HTTPS artifact checks followed by expected WORKFLOW-UI failure: CSV input expected
  hidden, received visible. Exit1; trace/screenshot in `browser-red-artifacts`.
- `unit-green.log`:118tests/21files PASS3.44s. `lint.log`: exit0,27existing warnings.
  Strict E2E types pass in `types-red.log` and `types-green.log`; OpenSpec33/33 PASS in
  `specs.log`. `production-audit.log`: exit0, two moderate findings/no high-critical.
- Initial source lint found an unnecessary fragment; removed explicitly and scoped
  check passed. `build.log` then exposed a pre-existing test type error from the prior
  workspace slice: three Testing Library role queries used Playwright's unsupported
  exact option. Removed only that ignored option, retaining string-name match and
  every assertion. Separate `build-fixed.log` exits0 with existing bundle warning;
  `focused-unit.log`:4tests/2files PASS1.02s. Prior workspace verification was corrected:
  its combined shell invocation had masked this local build failure with a successful
  subsequent lint. Its recorded Docker/browser successes remain valid, because the
  existing Docker context excludes test files. No failure is counted as success here.

Actual frontend `image.log` exits0:
`sha256:795d1b7ae04cc6d26753e418a3dc776c439e5d05635ee888e6e5c402b71d555c`.
Unchanged backend `sha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2`.

## Browser attempts

`capital-workflows-browser.cjs green`:3/4 passed, exit1,total1.0m. REWARD-UI12.7s,
SWAP-UI12.6s and CSV committed-confirm/MFA14.0s passed. The new scenario reached its
native-select keyboard step but ArrowDown/Enter left trades selected. Space before
ArrowDown/Enter also failed in the single-case `keyboard-green.log`; both attempts
and their artifact directories are retained, not counted as passing.

Standalone HTML diagnostics reproduced this in installed headless and headed macOS
Chromium; neither involved application/backends. ASCII type-ahead worked. Playwright
press rejects Cyrillic keys; type/insertText did not select the Russian option. Actual
Cyrillic keyDown/keyUp through a Playwright CDP session did select it. WORKFLOW-UI now
uses that native type-ahead input, keeps focus/value assertions, and does not assign
DOM values, dispatch synthetic DOM change events or mock any application response.
`native-green.log`: native keyboard, all four independent drafts/File, widths and
account sections passed their assertions. The run then failed at correction cancellation:
the new test scoped the cancel button inside the fieldset, but the unchanged TradeForm
renders it as a sibling. Trace/DOM snapshot confirmed the correct target1/100 and visible
cancel action. Corrected only the locator to the page's unique exact-name button;
added void target/version/confirmation/cancellation assertions to the same journey.

`final-green.log`: WORKFLOW-UI1/1 PASS13.9s (case13.2s), exit0, same candidate image,
one worker and zero retries. Final strict E2E TypeScript (`types-final.log`) and scoped
Biome12files (`format-final.log`) exit0. Four distinct selected browser cases pass
across the recorded runs; the failing attempts above remain recorded as failures.
Each harness starts actual migrations/owner CLI/HTTPS/MFA and disposable PostgreSQL;
only external provider fixtures are substituted. Actual release artifact checks pass.
Root inspected final trades360/swaps768/CSV1440 screenshots: controls and selected
editors fit their widths. The test also captures all four workflows at all three widths.
The verbose journal preface still consumes mobile space; reducing it and improving
individual fields/results remain frontend backlog, not claimed UX completion here.

Final Docker inventories contain no capital-tracker-e2e containers or networks.
Protected preview volume still exists, its old frontend tag remains7eff01d1, and all
preview containers remain stopped31hours earlier. Owner Nginx hash/mode/size and lock
hash above are unchanged; no owner data, preview credentials or original project changed.

## Review and limits

Root compared the entire existing TradeJournal state/effect/guard/callback block
against3ad13f7 byte-for-byte: unchanged. AssetSwaps, AssetRewards, CsvImports, TradeForm
and TradeResults sources are entirely unchanged. Presentation adds selection state
and wraps existing correction/void callbacks to reveal trades. No new read/write,
retry, eligibility or quota behavior was introduced. This is root inspection, not an
independent review; task3.1/archive3.3 remain unchecked under the existing agent quota.

Unrun: full E2E/browser matrix, unrelated financial/migration/security/release/hostedCI,
remaining frontend redesign, owner visual acceptance and maximum chart periods.
No full release, canonical spec synchronization, production readiness or preview update
is claimed. Original projects, preview data and owner edits remain protected.


## Independent review and final scoped verification — 2026-09-26

Required independent review now passes after the recorded fix/evidence closures.
Earlier quota statuses above describe previous checkpoints. See the consolidated
[final followup evidence](../../../../docs/reviews/2026-09-26-verification.md) for the
actual RED, two-field fix,118unit tests, build/lint/types/audit and three selected real
browser passes on FE64923db4/BEdd90a8c5. Full redesign/release/owner approval remain open.


## Archive completion — 2026-09-26

Supported `openspec archive <change> --yes` exited0 after review and behavioral gates.
The one pending checkbox reported by the CLI was this final archive/comparison
procedure; it is now complete. All five changes synchronized42delta requirement
blocks while preserving97other requirement blocks and20untouched spec files byte-for-byte.
`capital-reviews-spec-comparison.log` and strict `capital-reviews-specs-final.log`
pass;33canonical specifications and no active changes remain. Generated Purpose text
was clarified without altering requirements. Original swap proposal retains the CLI's
nonblocking >10deltas warning; shared-reader contracts were verified together.
Final test-labeled container/network inventories are empty. Preview volume/tag7eff01d1/
stopped containers, owner Nginx mode0644/size1348/hash and lock hash remain unchanged.
No preview update, owner data access, paid service, production or project deletion.
