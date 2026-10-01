## Context

Base628581c has41canonical specs/no active change. Read AGENTS, target redesign amendment, continuity, Settings/switch/FX sources, daily-display-fx spec and DFX-UI. Current manually gated workflow_dispatch/main/PRODUCTION_ROLLOUT_ENABLED pipeline remains unchanged.

Keep three section destinations, conditional panel mounts, language/theme persistence, exact raw FX strings, attribution/timestamps/freshness/last-good errors, original read/collect guards and stale-intent generations. Simplify Settings layout/selection cues and FX action/result hierarchy. Remove invitation-code CSS only: repository consumer search found its selectors only in Settings.css. Legacy currency-manager behavior is preserved and separately identified, not relabeled integration health.

## Goals / Non-Goals

**Goals:** usable responsive settings and a clear stored-data FX workbench with accessible controls.
**Non-Goals:** integration-health aggregation, legacy currency-manager/controller rewrite, provider/API/auth/backend/dependency changes, automatic collection, data migration, preview/production deployment or consolidation.

## Decisions

- Root owns Settings.tsx, DisplayFxPanel.tsx and optional IDs in language/theme switch components. Luna owns only Settings.css/DisplayFxPanel.css in capital-tracker-settings-styles. Sol owns existing DFX-UI acceptance extension in capital-test-settings-workbench. A separate reviewer authored neither tests nor product.
- Use a named group of native buttons with aria-pressed and a shared aria-controls target; no partial ARIA tab model. Keep focus on clicked/keyboard-activated button and original conditional rendering. General visible labels link through optional component id props; context/i18n/persistence callbacks remain unchanged.
- Keep amount form and saved-data actions together; put explicit collection in a separate labeled area with provider-call guidance. Preserve button names, types, handlers and guard expressions. Associated amount hint explains nonnegative exact decimal/zero and database-only reads.
- Reorder exact result table before always-accessible original timestamps, retaining freshness/failure/next-attempt cues and attribution. Captioned semantic table uses a named focusable scroll container with exact nowrap values; no numeric formatting or new economic state.
- Flat4px boundaries, readable theme tokens, no ornamental transitions, container-aware layout and44px targets. Native selector stays fully visible at360px. Language/theme switch styling remains scoped under Settings.

## Risks / Trade-offs

- Unintentional provider call or reset by eager panel mounting → original conditional mounts/effects/controllers retained, request-count checks before FX activation and exact DFX journey.
- New labels alter selectors or control behavior → IDs only, unchanged values/onChange/type/disabled callbacks and real preference changes.
- Result reorder hides stale/failure context → keep status and errors visible above exact table, all original evidence branches retained.
- Table/long action overflow → min-width0 ancestors, contained keyboard scrolling, real360/768/1440 light/dark captures.

## Verification and rollback

Baseline118frontend characterization tests remain. Extend existing DFX-UI (no new browser case), expected RED at missing named Settings selector before product changes. Selected real HTTPS/password/MFA/PostgreSQL22migrations checks preserve USD123.45→EUR111.105/RUB11125.314, initial database-only read, explicit collection counts, delayed amount read rejection, failed-provider last-good200→180/18024 and financial fingerprints. New navigation/preferences checks must not collect FX; real reads stay through own backend.

Required frontend tests/build/lint, strict all-E2E types, scoped Biome, production audit, strict OpenSpec and independent source/oracle/actual viewport review. Full backend/E2E/API/PGprecision suites, upgrades/liveproviders/scanners/hostedCI/release unrun. No migration/quota changes; rollback frontend only. Preserve owner Nginx/lock and preview; archive only after evidence, compare41oldcanonical files and newblocks, guarded integrate/temporarylink cleanup.
