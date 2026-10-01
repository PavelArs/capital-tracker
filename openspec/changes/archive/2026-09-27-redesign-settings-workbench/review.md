# Independent settings workbench review

Reviewed 2026-09-27. Verdict: **no blocking finding for this bounded frontend change**.

Candidate `6a65642d5cdc30a9d00e9fcc4271778961aab963`, base `628581c`, worktree `/Users/pavelars/Projects/temp/capital-tracker-settings-workbench`. Product authors: root and Luna. Acceptance author: Sol, integrated `607a992` with timing correction `cc632da`. This reviewer authored neither product nor tests, made no repository edits, and ran no Docker commands.

## Source and scope

Read AGENTS, continuity, target redesign requirements, active proposal/design/specifications, canonical daily-display-fx requirements, original and candidate Settings/switch/FX code, relevant context behavior, acceptance changes and structural verifier. Product changes are limited to Settings TSX/CSS, DisplayFxPanel TSX/CSS and optional ID props in the language/theme switches. No backend/API/provider/authentication/schema/dependency/deployment behavior changes are included.

- `Settings.tsx:29` uses a named group of three native type=button controls with aria-pressed and a shared aria-controls target. The content region is labelled by the active button. All IDs match, including the display-fx value. This avoids an incomplete tab model; clicking or keyboard-activating a button does not move focus into its panel.
- Original conditional mounts remain at lines68/94/103. General settings does not eagerly mount FX or currencies. Repeated activation of the current section does not introduce a new key/mount. Leaving and later returning to FX still intentionally recreates its existing local amount/result state and stored-data mount read; the redesign does not promise cross-section draft persistence.
- Currency visibility remains its legacy destination, with an honest notice distinguishing it from instrument accounting and indicative FX. The existing CurrencyManager read/toggle implementation is untouched. Its mount reads are not incorrectly treated as forbidden FX requests.
- Visible language/theme labels are associated with actual select IDs. Optional props only forward those IDs; original i18n selection/storage and theme/system-media behavior are unchanged. Source search found no remaining consumers of the removed invitation-code/code-box/copy/generate/status CSS selectors.
- `DisplayFxPanel.tsx:155` retains the stored-read form. The amount remains type=text, required and inputMode=decimal with its raw string value/edit callback. The new explicit label and aria-describedby hint state exact nonnegative USD, decimal point, valid zero and database-only calculation.
- Independently checked types excluded by the AST audit: the calculation remains type=submit at line175, stored refresh remains type=button at line180, and external collection remains type=button at line192. Collection is outside the form in a separately named section, with unchanged disabled expression and collect handler. It cannot accidentally become a submit action.
- All original loaded/requestedAmount/currentAmount/generation/mounted guards, collection/read locks, fetchSaved/readSaved/collect code and view derivation remain unchanged. No numeric conversion or economic state was added.
- Exact server strings remain in the semantic result table. The table now precedes observation publication/fetch/next-update/EOL metadata, while freshness, provider-failure context, next-attempt timing, attribution, notices and errors remain available. Missing observation still means no table, not zero. Last-good values are not replaced on collection failure.
- Styles preserve min-width0 containment, responsive selectors/fields,44px controls, readable theme tokens and visible focus. The FX table is captioned and contained in a named tabindex0 scrolling region with exact nowrap cells. No error/status branch is hidden by the CSS.

## Acceptance review and resolved finding

Reviewed both the initial acceptance diff and final timing correction independently.

- The predecessor RED is the missing named Settings group before fixture reset. New selection assertions check native controls, pressed state, content relationships and keyboard focus; actual English/Russian and light/dark/system changes exercise existing preference persistence.
- Before-first-FX request monitoring filters only `/api/reporting/usd-display` and its refresh path, allowing the legacy currency stored reads. The first FX activation still requires its real stored GET with unavailable state and no provider call.
- The same-active-section check originally started its500ms timeout before the click. I identified that a slow actionable click could consume the observation window. `cc632da` resolves this: a request listener covers the entire click and selected-state checks, then remains attached for500ms afterward, with finally cleanup. This is bounded absence evidence, supported by unchanged source mount behavior.
- The amount hint and form/collection separation, exact table-before-publication order, named keyboard scrolling and responsive capture assertions are explicit.
- Original financial/provider assertions are retained: USD123.45 returns EUR111.105/RUB11125.314 with rates0.9/90.12; explicit collection adds one provider call; delayed123.45 cannot override edited200; explicit new read returns180/18024 without collection; a later failed explicit collection preserves those last-good values with stale context and exactly two provider calls overall. Financial fingerprints remain unchanged.
- Theme captures use real preference changes for General. FX captures use actual system color-scheme media changes after system mode is restored, keeping FX mounted and amount123.45 intact. No fabricated backend/authentication response was introduced; original delayed delivery uses the real upstream response.

## Observed execution evidence

Root ran the commands. I read the terminal logs and inspected artifacts.

- `/private/tmp/capital-settings-workbench-red.log`: authenticated predecessor reached the page; expected bounded10s failure was missing `group` named `Разделы настроек`. This is behavior RED, not setup/import failure. Cleanup completed.
- `/private/tmp/capital-settings-workbench-controls.log`:14 control/props signatures and module/pre-render controller logic passed unchanged across four TSX files. I read the verifier; it excludes type and does not prove conditional placement or accessibility relationships. Those were checked directly above.
- `/private/tmp/capital-settings-workbench-green.log`: **1 passed (17.9s)**; DFX-UI17.2s, one Chromium worker. Artifact/proxy checks identify frontend `sha256:9f53b3f46a042d5759c91956e86295563186c0124826f34bc7b8230e30279571` and unchanged backend `sha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2`. Teardown completion is visible.
- Root reports local frontend118tests/21files, build, lint, strict E2E types, scoped Biome and production audit passed, with existing27lint warnings, build warning and two moderate audit findings retained. I did not rerun those commands.

## Independent FX visual review

Personally inspected all12 `settings-fx-*.png` frames under:

`/private/tmp/capital-settings-workbench-green-artifacts/display-fx-DFX-UI-Settings-c86c0-discards-stale-amount-reads-chromium/`

The set contains two vertical slices for each light/dark ×360/768/1440 combination. All three section choices remain available without horizontal navigation scrolling. The selected section, amount123.45, associated guidance, primary database calculation and separate provider collection area remain readable. Attribution, freshness and wrapped UTC evidence remain reachable. The table and its focus outline stay within the result card; at1440 all exact EUR111.105/RUB11125.314 values are visible. At360 and768 the table intentionally needs horizontal scrolling; captures are at the left edge, so the full rightmost amount cells are not visually established at those widths by the static images alone. The executed acceptance checks exact cell text and real ArrowRight movement of the named scroll region. No page-level overflow or overlapping controls were observed.

The six General-settings product frames were independently assigned to Sol; I do not claim viewing that set. My General review is source, test-oracle and execution evidence.

## Limits

This is a scoped frontend review, not full product UX/accessibility or production approval. The selected journey establishes available/unavailable/stale behavior, preserved last-good values and the real explicit-collection boundary. Captures show the fresh123.45 result; they do not visually enumerate every error, EOL, disabled or maximum-decimal state. Keyboard/ARIA checks do not constitute a complete screen-reader or cross-browser audit.

No full backend/E2E/API/PG precision suite, populated upgrades, live providers, scanners, hosted CI, production or durable preview was run by this reviewer. No mandatory correction remains from this review.
