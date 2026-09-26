# Independent trade workbench review

Scope: read-only source/oracle review in capital-tracker-trade-workbench, baseline0370395, QA4c0a344 and CSS964ac77/1cac4df. No Docker, install, product/test edits or private preview access. Whole frontend redesign remains ongoing.

## Initial oracle review

- Existing WORKFLOW-UI assertions remain intact. Keyboard activation/cancel tests retain originating DOM node identity and exact trade draft values. First new assertion targets genuine missing history-to-editor focus on predecessor rather than artificial CSS failure.
- Associated-description assertions verify total USD versus unit price, separate fee, UTC, equal-time order. Exact 18-place input strings and original mounted draft/File assertions remain.
- Ordinary typing/disclosure/resize focus, no accounting/provider requests, exact business-state snapshot remain covered. Retained WORKSPACE actual committed-response-loss replay remains required.
- Gap to resolve/document before archive: disconnected/disabled-origin cancellation fallback is required by WORKBENCH-002 but initial browser acceptance only exercises connected/enabled origins. Source review and bounded coverage must explicitly address this case.
- Responsive acceptance proves no page overflow and history action targets >=44px. Table-local scrolling is not directly asserted; source and screenshots must confirm it.

## Initial CSS review

CSS964ac77/1cac4df remains scoped to .trade-results. It changes no controller, DTO, table captions/columns or arithmetic. Existing transfer-fee dl wrappers are flattened with display:contents so dt/dd grid pairing is preserved. Theme vars exist; result buttons have44px minimums and explicit focus styling. Table wrapper inherits overflow-x:auto from ManualAccountDetail.css. Import must follow TradeJournal.css to preserve CSS cascade.

Implementation and screenshot review pending parent freeze.

## Frozen implementation review

Frozen uncommitted TradeForm/TradeJournal/TradeResults source plus result CSS integrateddb49c5c/083b607 reviewed independently. No material source findings.

- useLayoutEffect depends only on accepted monotonic editorFocusRequest; ordinary input, refresh, disclosure, resize and workflow state cannot schedule focus. Focus uses preventScroll before start-scroll. Current global styles contain no smooth scroll rule.
- Explicit selection captures event.currentTarget and changes workflow/increments focus request only after existing ambiguous/write/CSV/carry guards. TradeResults passes trigger only; its loading/data/revision/pagination/evidence controllers remain unchanged.
- Cancel retains previous guards and lifecycle reset, then clears origin and focuses it only while connected/enabled; otherwise persistent workbench receives focus. New QA0c4ef9d genuinely refreshes/remounts results, checks old button disconnected and replacement different, keeps refresh focus, then verifies fallback without writes/providers.
- Wrapper stays mounted. Conditional JSX slots preserve TradeForm identity across create/correct and ordinary workflow changes. Existing void branch remounts the trade editor as before; no new key resets were introduced.
- All native labels, disabled/lockDraft/submit/cancel controls and string onChange paths remain unchanged. Guidance IDs come from useId, and helpers sit outside labels, preserving existing accessible names.
- Result stylesheet follows TradeJournal.css, and form theme overrides have higher specificity than its old white control styles. New QA explicitly checks overflow-x:auto and positive360px table scroll width.

Actual parent GREEN and twelve final form/results screenshots remain pending.

## First candidate failure review

Parent log /private/tmp/capital-workbench-browser-green.log:1passed/1failed38.7s. WORKSPACE actual committed-loss replay passes13.5s. WORKFLOW correction/void focus and connected cancel passed before line294 visibility lookup failure for exact getByLabel('Инструмент'). Error-context ARIA snapshot exposes visible exact combobox names Инструмент and Тип сделки; native nested select markup is unchanged. Existing usd-trades/account-workspace helpers use exact getByRole('combobox', name). Correcting only these two new select visibility locators retains accessible name/visibility intent; no financial/focus assertion weakened. Product unchanged.

## Second candidate and screenshot review

Parent GREEN2 log:1passed/1failed39.4s. All guidance/precision/theme/width/action-target assertions pass before fallback assertion expecting refresh button remains focused. That assertion exceeds WORKBENCH-002: existing refresh button disables while loading, which naturally loses focus. Contract forbids refresh scheduling history focus. Approved narrow replacement with correctionWorkbench.not.toBeFocused after real row replacement/loading completion, retaining disconnect/replacement, explicit cancel fallback, GET-only and exact business/provider oracles. No product change needed.

Viewed all12screenshots at360/768/1440 in light/dark. Grouped form layouts fit, long exact gross/fee input text readable, helper descriptions localized, result captions/totals/exact tables retained and contained. Desktop result actions theme-consistent and adequate size. Mobile tables scroll locally as asserted and show complete values with wrapping rather than truncation.

One evidence finding remains: dark360 form was captured during inherited0.2s background-color transition after theme switch. Light-gray controls and pale text reduce contrast, while later dark768/1440 controls are correct. Requested finite transitions disabled for captures or final computed color assertions before screenshot, then regenerate final12shots. This is screenshot timing; no theme source defect found. Approval awaits corrected final images and actual all-pass acceptance.

## Final disposition

Approved bounded trade workbench implementation/oracles/visuals with no remaining material findings.

Independently reviewed QA144da88 (refresh forbids editor focus) and63077f1 (finite screenshot transitions disabled). Retains all behavioral, economic and no-implicit-write assertions. Final actual parent log /private/tmp/capital-workbench-browser-green3.log reports WORKFLOW1/1PASS16.9s,1worker; frontend imageb7948fbfff827f64903d7ed904dcc1eff256ff3e6442dec76c54f5dd89cee54f. WORKSPACE passed separately on same product image before only test fixes; no unaffected rerun required.

Viewed all12final images under /private/tmp/capital-workbench-green-artifacts/account-operation-workflow-2d212-s-without-implicit-commands-chromium/. Dark360 now has final dark control backgrounds and readable text; transition capture finding resolved.360/768/1440 form/results light/dark show intended responsive groups, exact gross/fee values, complete contained table evidence and theme-safe actions. All initial review gaps resolved by actual acceptance/source review. This approval is limited to trade workbench scope; full frontend redesign/owner visual acceptance and broader release gates remain open. No Docker/tests/install/product edits performed by reviewer; only this report written.

## Final CSS refinement and accepted replacement image

Root additionally identified desktop type label split as Пок/упка. Reviewed CSS461ee0c: one scoped th/td overflow-wrap:break-word rule overrides old anywhere behavior without controller/content changes. It retains natural word min-content and local scrolling for longer evidence.

Re-reviewed all12replacement images under /private/tmp/capital-workbench-green-artifacts. At1440 Покупка now stays one readable word; headers and UTC evidence also wrap at meaningful boundaries. At768 type remains one word; at360 UUID/instrument fragments wrap at their natural hyphens with wider columns and local horizontal scroll, preserving full exact values. Tables remain contained and form remains unchanged/readable in both themes. No remaining material findings.

Final accepted FEsha256:8e48e2fa1d3efd6196e1267446cf5bdde47afa79b772d395a80684bc8589844a. Independent log inspection /private/tmp/capital-workbench-browser-green4.log confirms2/2PASS29.5s on this replacement image (WORKFLOW and WORKSPACE), unchanged backend. This replaces historicalb7948fbf approval as current accepted image. Earlier failures/transition finding and corrections remain documented above. Approval remains bounded to trade workbench; full frontend redesign and owner visual acceptance are outstanding.
