# Frontend screen and journey inventory

Source audit at4decf5a,2026-09-26. This is the implementation baseline for the owner's
complete redesign request. No new UI or responsive verification is claimed here.
The retained local preview has not been rebuilt or reset.

## Current surfaces and disposition

| Surface / source | Finding | Keep / simplify / remove |
| --- | --- | --- |
| `/login`, Login/Auth.css | Actual password, TOTP and recovery flow; large gradient backdrop and separate form styling | Keep authentication and validation; simplify presentation and focus/error states |
| Shared Layout | Nine ungrouped horizontal links; mobile user block is positioned by measured height, timeout, resize and transition handlers; no current-route indication or skip link | Replace arrangement and timing logic with responsive semantic navigation; keep real logout/error handling |
| `/`, Dashboard | Legacy assets/liabilities/wallet metrics and30-day history are not manual journal valuation | Move intact to a labelled legacy route; use manual accounts as the working entry until a real portfolio overview is implemented |
| `/manual-accounts`, ManualAccounts | Account creation precedes the account list; selected-account valuation follows both | Keep APIs and scoped valuation; later lead with accounts, make creation an explicit action and move valuation to a focused view |
| `/manual-accounts/:id`, ManualAccountDetail | Opening editor, journal and instrument management, current positions and revisions accumulate on one page | Keep exact data, opening/carry-in guards and drafts; later split overview, operations, holdings, history and account setup |
| Nested TradeJournal and AssetSwaps/AssetRewards/CsvImports | Multiple complete editors and evidence readers share a long page; separate committed-response recovery is already implemented | Keep frozen retries, independent drafts, financial oracles and copyable evidence; later open the selected operation workflow on demand |
| Nested HistoricalAccounting/HistoricalValuation/ValuationHistory | Honest exact-instant price coverage and bounded account chart; repeated standalone controls | Keep calculation/coverage contracts; later unify date context and compact missing-evidence states. Maximum-period work stays explicit |
| `/owned-transfers` | Protected create/review/correct/void workflow with original lot provenance | Keep operation semantics and recovery; simplify account selection, progressive detail and history layout |
| `/capital-flows` | Separate external-flow journal and review | Keep USD-only scope and immutable commands; later group under operations without conflating owned transfers |
| `/manual-prices` | Manual exact-time prices and revision history | Keep exact inputs and missing-price distinction; later present as price data management, not live-provider coverage |
| `/period-profit`, embedded LinkedTwr | Manual period inputs and conditional XIRR/TWR results | Keep limitations and independent results; later build one coherent performance view |
| `/settings` | General/theme/language, legacy currencies and indicative display FX panels | Keep persisted preferences and FX provenance; later group by purpose. No integration-health capability is claimed yet |
| `/assets/*` | Legacy asset tabs/editor/cards/chart | Keep reachable under “Прежние данные”; replacement/removal needs its own scoped change and data inventory |
| `/crypto` | Legacy wallet list/provider balances | Keep reachable with legacy grouping; do not imply six complete network adapters or accounting reconciliation |
| `/liabilities/*` | Already retired authenticated notice with link to manual accounts | Preserve notice, direct links and backend data; never restore the retired navigation entry |
| Unknown route | Existing redirect to login | Preserve default-deny routing in this slice |
| Currencies.tsx / Metrics.css and other apparently orphaned surfaces | Not direct routes in App.tsx; some currency features are embedded in Settings | Investigate imports before removal; filename presence alone is not evidence of safe deletion |

## Critical journeys to retain

Actual login → TOTP/recovery → private account entry → explicit logout; direct
unauthenticated private links; create/account opening/carry-in; record/review/correct/
void trade, reward, swap or transfer; lost committed response → SPA navigation → same
request retry; independent draft preservation; CSV mapping/preview/import/rollback;
historical/price-missing valuation and selected-account totals; period result and
insufficient-data explanations. A shell redesign must not reset the mounted outlet
merely because navigation is expanded, theme changes or the viewport is resized.

## Target hierarchy and visual rules

Working entry: **Ручные счета**, with clear manual/selected-account scope. Primary
navigation: Ручные счета, Переводы между счетами, Вводы и выводы, Ручные цены,
Прибыль за период, Настройки. Preserve these established labels during the first
slice to retain working journeys. A subordinate **Прежние данные** group contains
Прежний обзор, Активы, Криптокошельки. It never represents complete current value.
The later portfolio/operations hierarchy belongs to FUI-03/04, after those screens
can actually support it; do not add empty AI or integration-health destinations.

Desktop: compact left navigation, narrow utility header, flexible content area.
Mobile/tablet: labelled menu disclosure in document flow; no separately positioned
user panel, overlay animation or measurement timers. Content width uses min-width:0;
individual wide tables own their overflow. All primary destinations remain reachable
with the keyboard and touch. Show active navigation with text/shape and aria-current.

Visual direction: neutral warm-gray workspace, white/slate surfaces, muted blue accent,
thin borders, small radii, restrained typography and tabular numbers. Borrow the clear
structure of early desktop applications without imitating obsolete controls. Keep
light/dark preferences. Use visible focus, normal readable type and no ornamental
gradients, moving cards or menu transitions. Never fit exact amounts by silently rounding.

## Installed tools and first slice

Package audit: React18/TypeScript/Vite, React Router6, native controls/custom CSS,
Chart.js/react-chartjs-2. Mantine/ECharts are absent. The initial shell change reuses
the existing equivalent routing, controls and theme/auth contexts; it needs no new
component library, chart migration or lockfile edit. Evaluate Mantine for new complex
editors/dialogs and ECharts for the later chart redesign, with authoritative version
checks before adoption. Existing Modal lacks explicit dialog/focus management; do not
reuse it for a new navigation overlay.

First change: `redesign-application-shell`, limited to shell, default landing, legacy
overview notice and login presentation. Existing account/editor layouts remain for
later changes. Required widths360/768/1440 and retained financial journey checks are
specified in its artifacts. FUI-01 remains partial until responsive prototypes and
their review exist; FUI-02..06 are not complete.


## Account-directory checkpoint, 2026-09-26

Active `redesign-account-directory` implements the next bounded part of this inventory:
accounts lead the page, creation uses an explicit mounted disclosure, and selected
valuation is collapsible. Pagination and exact preview state are retained; checkbox
sizing is corrected locally. See [the guide](account-directory.md) and linked runtime
evidence. FUI-03 remains partial.

## Account-workspace checkpoint, 2026-09-26

Active `redesign-account-workspace` separates operations, analytical tools and initial
data through native section buttons. Hidden contents stay mounted; the original
journal eligibility/retry/cross-editor locks remain. Initial-data labels now identify
the saved opening snapshot instead of implying current holdings. Compact shared
refresh/error/recovery remains accessible. See [the guide](account-workspace.md).
Analytical tools still have independent date inputs. Independent review, broader
redesign and owner visual approval remain pending; preview remains unchanged.

## Operation-workflows checkpoint, 2026-09-26

Active `focus-account-operation-workflows` presents one selected trade/swap/reward/CSV
workflow while preserving all mounted state and shared journal results. History actions
reveal the trade editor or void confirmation. Exact drafts, CSV File and hidden recovery
locks are verified through real HTTPS/MFA/PostgreSQL; see [the guide](account-operation-workflows.md).
Responsive screenshots cover all four choices at360/768/1440px. Root visual inspection
confirms the verbose journal context still takes excessive mobile space. Compact context,
field ergonomics and clearer result tables are next; no complete redesign or independent
visual review is claimed. Preview remains unchanged.
