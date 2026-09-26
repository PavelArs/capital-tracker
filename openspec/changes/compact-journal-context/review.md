# Independent review: compact-journal-context

Reviewed frozen source against 93b2ae8, QA commits 8d3bacd/0c3c57a and uncommitted formatting/product followup. Read AGENTS.md, CONTINUITY.md, target brief, active proposal/design/spec/tasks, affected source and full acceptance journeys. Reviewer did not author or edit product/tests, run Docker, install packages or access the private preview.

## Findings

Approved for the bounded change. No remaining actionable findings. One P2 acceptance locator defect was found in the first candidate run, fixed in8df86c6, independently reviewed, and resolved by actual GREEN2 below.

## Source assessment

- TradeJournal.tsx:27-29,484,536-554 retains original complete initialization, exact revision/UTC coverage, capacity/limits, allocation and accounting-scope prose. Initialized context uses native details/summary with no open prop, custom toggle state, timers or request handler. It starts closed and DOM-owned state survives ordinary reconciliation. Uninitialized warning and explicit initialization branch remain outside details.
- TradeJournal.tsx:379-478 retains global journal errors, unresolved-request retry, receipt and stale-review controls before AccountWorkspace, outside details and section visibility. Controller/state/key/retry/request/draft logic is byte-unchanged. AccountOperations remains a sibling, so context toggles cannot unmount or reparent editors.
- TradeJournal.css:61-86 adds scoped summary target/focus and context wrapping. No fixed width, truncation or animation. Existing min-width/global border-box rules support responsive containment.
- ManualAccountDetail.tsx:486-488 retains account/revision key, so real account changes remount native details closed. AccountWorkspace uses mounted hidden panels, preserving native disclosure state on section changes.

## Acceptance challenge

Initial toBeHidden assertions permit absence, but subsequent exact visible revision, capacity, initialization/allocation/full scope assertions prevent a false pass from deleting content. Native Enter activation/focus/open checks observe browser behavior, not fabricated toggle events. Exact drafts, original editor node identities, same CSV File identity, no accounting requests, unchanged business-state/provider counters, original committed receipt/body replay and actual SQL single-version checks are retained. Ordinary expanded-state metadata updates and actual account return closed are asserted.

The new uninitialized assertion checks original warning and absence of disclosure, but does not add an explicit assertion for the permitted initialization button. This is an optional test-hardening gap, not a product regression or blocker: the entire initialization form and eligibility guards are unchanged. Enter is exercised; Space and other browser engines remain outside this Chromium scoped gate.

## Evidence inspected so far

- Baseline log: 118 tests/21 files pass, 3.46s.
- Candidate unit log: 118 tests/21 files pass, 3.84s. Candidate build completes; existing Vite chunk warning remains. Candidate lint records 27 existing warnings.
- Formatting log checks four files without fixes; strict E2E types log has no diagnostics. OpenSpec log records 34/34 strict items. Audit log records two moderate findings and no high/critical report; parent owns actual exit evidence.
- Actual predecessor browser RED log identifies FE64923db446c89cc808f1de71bc28392484e60e06208136a84bb77ab2df528631 and the intended revision expected-hidden/received-visible failure at account-operation-workflows.spec.ts:25.
- Candidate image build records FEab29708ca75a9b60c738ecd9d63d92abb2150c51a3f12e221a4a001756c822b4.
- At the initial source-review checkpoint, browser GREEN and screenshot review were pending. Completed runtime and final screenshot evidence are recorded below.

## Responsive visual review

Directly inspected all six candidate screenshots in test-results/account-operation-workflow-2d212-s-without-implicit-commands-chromium: compact/expanded at360,768,1440. Context has no observed clipping or horizontal overflow; complete timestamps/prose wrap, native disclosure markers and focused summary outline are visible, and compact context gives the workflow space. Long expanded mobile prose remains intentionally full and scrollable. Screenshots are synthetic acceptance artifacts, not owner UX approval or a complete redesign review.

Parent confirms candidate unit/build/lint/style/types/audit commands all exited0; audit retains two moderate findings. No additional source edits were made during this independent review.

## Actual first candidate browser result and finding

Completed browser-green.log records one pass (WORKSPACE12.0s) and one failure (WORKFLOW timeout; total2.2m). No all-green claim is made.

P2 acceptance defect — tests/e2e/account-operation-workflows.spec.ts:182: the new strict node-identity loop evaluates quantity while the selected workflow is imports. Quantity's ancestor locator is getByRole('group', name 'Сделка в USD') with default hidden exclusion, so it has zero matches when the trade panel is hidden; locator.evaluate waits until the120s timeout. The preceding original-handle isConnected assertions passed, so this failure does not demonstrate a product remount. Preserve the identity oracle by choosing the matching workflow before each role-dependent equality check (or selecting trades before this loop, since other labels include hidden inputs). This was a required blocker before archive; resolution and actual rerun are recorded below.

## Test correction review

Independently reviewed QA3d9b685 integrated as8df86c6 and its formatting followup. Approved: tuple now includes each matching workflow, selects it through the existing visible native workflow control, then retains strict element===original assertion. Original handle isConnected checks, same CSV File, final exact drafts, no-request/business-state/provider oracles remain unchanged. It ends on imports, preserving subsequent File assertion context. This resolves the hidden-role locator defect without accepting a replacement node or weaker identity. Product source is unchanged. The subsequent actual GREEN2 result is recorded below.


## Final verification and disposition

Inspected completed /private/tmp/capital-context-browser-green2.log: WORKFLOW passes14.1s and WORKSPACE passes11.7s, two cases pass26.5s, one worker. Parent confirms process exit0 and zero retries; completed log also records synthetic Docker teardown. Same candidate frontend FEsha256:ab29708ca75a9b60c738ecd9d63d92abb2150c51a3f12e221a4a001756c822b4; unchanged backend BEsha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2.

Directly re-inspected all six final screenshots from /private/tmp/capital-context-green-artifacts/account-operation-workflow-2d212-s-without-implicit-commands-chromium; same favorable context containment/wrapping/focus observations at360/768/1440. Inspected style2.log (four files, no fixes) and types2.log (no diagnostics); parent confirms both final processes exit0. Earlier1pass/1fail remains explicit historical evidence, not overwritten or characterized as success.

P2 acceptance defect is resolved. Independent approval: compact-journal-context meets this bounded presentation/retained-behavior scope, with no remaining blocker. This approval does not cover complete frontend redesign, owner visual acceptance, other browser engines, full release/security/migration gates, private preview refresh or production deployment. Reviewer made no product/test changes and did not run runtime infrastructure.
