# Independent period-review workbench review

Reviewed on 2026-09-27. Verdict: **no blocking finding for this bounded presentation change**.

Candidate: `bcb9699b239a7e204f7ab09c8339a03dbc33b85e`, base `97ca8da`, worktree `/Users/pavelars/Projects/temp/capital-tracker-period-workbench`. Product authors were root and Luna; acceptance author was Sol. This reviewer authored neither the candidate product nor the acceptance additions, made no repository edits, and ran no Docker commands.

## Scope

Read AGENTS, the accounting brief and period redesign amendment, the active proposal/design/specifications, the product diff and complete relevant render branches, the acceptance diff and shared screenshot/disclosure helper. Compared the prior PROFIT/XIRR/TWR/LTWR behavior and reviewed the control-audit implementation and output rather than treating its result as a complete UI proof.

Product changes are confined to `frontend/src/pages/PeriodProfit.tsx`, `LinkedTwr.tsx`, and `PeriodProfit.css`. No backend/API/authentication/dependency/schema/migration/deployment changes are in the candidate diff.

## Source findings

- `PeriodProfit.tsx:359` uses an unconditional native `details` wrapper around `LinkedTwr`. The wrapper sits outside the existing `from + NUL + to` key, which remains on the child at line363. Opening or closing the disclosure therefore does not recreate its controller. Existing period changes still recreate the child; valuation changes still use the existing distinct invalidation path. There is no toggle handler, new automatic request, or new state/effect.
- The existing generation, mounted-state and current-valuation response guards are unchanged. The source retains the owner key and all existing control event handlers, disabled/review conditions, request arguments and input string handling. The structural audit independently records 11 + 4 unchanged control/props signatures and unchanged module/pre-render logic; this is supporting evidence, not a substitute for the mounting review.
- `PeriodProfit.tsx:123` keeps whole-portfolio USD, manual estimates, temporary/non-persistent results, unreconciled flows and the absence of current cash-balance calculation visible outside method details. The two date labels and their `htmlFor`/`id`/`aria-describedby` associations are retained; start-included/pre-flow and end-excluded guidance remain adjacent. Valuation help still states that capital and cash are counted once.
- Exact profit remains outside evidence details at `PeriodProfit.tsx:268`, with the original response period at line272. Revision, coverage, valuations, flow totals and count remain in native evidence details. Each result-scoped definition has one corresponding term/value pair; no duplicated primary metric was introduced.
- XIRR remains explicitly annualized with its short-period warning and existing unavailable reason. Endpoint TWR remains period-only with its unavailable reason, starting-capital evidence and rounding warning. These branches do not introduce numeric placeholders or turn an unavailable rate into zero.
- `LinkedTwr.tsx:232` preserves exact linked return/profit, adds the response period visibly, and keeps unavailable reasons outside its nested evidence disclosure. The evidence table at line273 is a named, focusable, contained scroll region. Original `valueBeforeUsd ?? '—'` and `valueAfterUsd ?? '—'` rendering remains at lines294–295, so zero is not treated as missing.
- CSS uses constrained widths, `min-width: 0`, wrapping exact definition values, responsive field columns, existing theme tokens, 44px main-control targets and visible focus outlines. The linked editor remains a single column. No CSS rule hides an error or alters the available/unavailable branches.

## Independent acceptance review

Reviewed commits `7a7c22e` and `5c3824a` and `tests/e2e/period-workbench-fixtures.ts`.

- The new method and evidence assertions require actual native SUMMARY/DETAILS elements, initially closed state, Enter/Space operation and no browser requests during presentation-only toggles.
- The linked case checks entered value, checked review, plan revision and enabled calculation across close/reopen; it then checks exact return21 and profit310, preserved result and evidence state across another toggle.
- The existing delayed real boundary response is now delivered after a period edit while the linked disclosure is closed. The test still requires the old plan to remain absent after reopening. The valuation-edit path is also exercised while folded, preserving the original distinction: plan/value retained, review/result cleared.
- Retained late preview and changed-journal409 assertions are not weakened. The PROFIT case still checks exact zero and loss(-100), response-loss handling, reviewed-input reset and rejection of delayed stale results.
- The existing financial fingerprints, admission deltas, provider-request equality and request ceilings remain unchanged. Existing XIRR/TWR cases retain available/unavailable and late-result assertions. No fabricated application or authentication response was added; delayed/failed delivery still operates on real upstream responses.
- The capture helper checks page overflow and visible main-control heights at360/768/1440 in light and dark themes. The linked table test requires a named tabindex0 region and actual ArrowRight scrolling at360. Screenshot generation changes only viewport/theme and scrolling.

## Observed execution evidence

I read the terminal logs; root executed the runs.

- `/private/tmp/capital-period-workbench-red.log`: real setup reached the predecessor page; the intended assertion failed because `Как считаются показатели` did not exist. This is behavioral RED, not an import/startup failure. The log records the bounded10s visibility assertion and cleanup.
- `/private/tmp/capital-period-workbench-green.log`: **4 passed (51.7s)**, one Chromium worker. LTWR14.7s, PROFIT13.1s, TWR11.7s, XIRR11.5s. Release/proxy checks identify frontend image `sha256:78436d00c6a36f0109abe0505dbff20fc21d8fe67642cc605b79d3dc51b3fa41` and unchanged backend `sha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2`. Cleanup completion is visible in the log.
- `/private/tmp/capital-period-workbench-controls.log`: both TSX structural comparisons passed. I also read the verifier: it compares selected control/props AST signatures and pre-render logic, but does not establish wrapper placement or accessibility associations. Those were reviewed separately above.
- Root reports frontend118tests/21files, build, lint, strict E2E types, scoped style and production dependency audit passed. I did not rerun those commands. Existing lint/build warnings and two moderate audit findings are not represented here as newly fixed.

## Independent profit screenshot review

Personally inspected **all20** profit frames under:

`/private/tmp/capital-period-workbench-green-artifacts/period-profit-PROFIT-UI-PR-7df3d-s-errors-and-late-responses-chromium/`

The set covers both themes at360,768and1440, including header/method scope, the entire input section and the actual zero-profit result with evidence open. At360 the inputs/actions/definitions stack; at768 and1440 the grouped inputs and result definitions remain readable. The exact zero, ISO period, input amounts1000/2000, flow totals1000/0/1000, count1, revision1 and coverage are legible. No overlap or horizontal clipping was observed. Evidence-summary focus is clearly visible in both themes. Wrapped coverage text remains readable at360. The screenshot slices overlap intentionally and do not imply missing content.

Linked product screenshots were assigned to Sol separately; I do not claim independent viewing of that22-frame set. My linked review here is source, acceptance and terminal execution evidence.

## Limits

This review is sufficient for the scoped presentation change, not a whole-product or production-readiness approval. No full backend/E2E matrix, populated migration suite, live providers, scanners/DAST, hosted CI, production deployment or preview rollout was run by this reviewer.

The recorded profit images show zero; the real test also asserts the loss branch. They do not visually enumerate every rate-unavailable/null-boundary branch or maximum-length decimal string. Missing-value semantics were independently checked in unchanged source; the selected run does not create a null-boundary screenshot. Keyboard evidence covers native disclosure operation and the linked table scroll region, not a comprehensive screen-reader or cross-browser accessibility audit.

No mandatory follow-up correction was identified.
