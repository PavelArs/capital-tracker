# External flow workbench product review — 2026-09-27

Verdict: no blocking finding in the bounded product/source and screenshot review.

## Roles and scope

I authored the FLOW-004-A acceptance extension in 5df23b9 (integrated by root as 564621d). Root independently reviewed those acceptance changes and corrected the period-guidance assertion ordering in 303f430: the period controls render only after journal initialization. Root also added a visible-summary assertion to bound predecessor RED failure. I acknowledge that feedback. This report does not claim independent review of my own tests.

I separately reviewed product implementation authored by root/Luna: TSX34aee29, CSS integrated26bd124, root followups b514f64 and20d9feb. Review baseline75a0f6b. Product scope is frontend/src/pages/CapitalFlows.tsx and CapitalFlows.css only. I made no product edits and ran no Docker commands.

Read AGENTS, continuity/target brief, current external-flow-workbench delta spec/design, existing external-usd-flows spec, inline CapitalFlowsOwner controller, API DTO/client and owner-scoped in-tab recovery store. Compared source changes directly against75a0f6b. Root's structural audit log corroborates unchanged11form/input signatures and10financial/recovery/read definitions; I did not author that audit.

## Product findings

No blocking findings. Exact raw-string values, required/disabled behavior, explicit coverage/external attestations, expected journal revisions, create/correct/void command construction, original-command retry and definitive-error/review guards are preserved. The API/recovery files and owner-key remount remain unchanged. Period invalidation, continuation revision pins, mixed/stale-read refusal and immutable version generation checks remain unchanged.

Focus requests are changed only by initiating correction/void/version click handlers. The layout effect depends on that request, so network completion cannot retrigger focus. Correction retains saved exact values and the original cancellation semantics. Each panel retains its own initiating button. Cancel/close restore only a connected enabled action and fall back to the visible focusable page heading. Closing versions calls the existing invalidateVersions function, increments the generation and clears the selection/data/error/read state; outstanding success/error delivery cannot reopen a closed panel.

Native initially collapsed rules retain all existing exclusions and the full reload/in-tab-memory caveat while owner-declared/unreconciled scope stays visible. New guidance is outside labels with unique useId-based aria-describedby associations. Exact flow IDs remain selectable in native details/code. Economic table columns lead with UTC/direction/amount; both tables retain exact data and descriptive captions. Named focusable regions contain horizontal scrolling. Controls have44px minimum heights, compact checkboxes sit in44px labels, native list markers and visible keyboard/heading focus outlines remain present. Local styles use existing readable light/dark text tokens and min-width:0 grid/card ancestors.

## Actual visual evidence inspected

Viewed all26PNG files under /private/tmp/capital-flow-workbench-green-artifacts/external-usd-flows-FLOW-00-abd5c--and-reviews-a-contribution-chromium/ using view_image:
- Six initialization viewport images: light/dark ×360/768/1440.
- Six filled correction/editor images with unsaved1300 and saved period1200.
- Eight period viewport segments: two360segments per theme, one768/1440segment per theme.
- Six version-panel viewport images: light/dark ×360/768/1440.

These are actual full viewport screenshots, not element clips or masked compositions. Forms/guidance/checkbox labels and exact recorded totals are readable. No visual page overflow, overlapping controls, hidden skip link artifact or obscured recovery information was found in these states. Narrow tables intentionally contain columns beyond the region width; region focus outline is visible. The runtime assertions provide keyboard horizontal-scroll and no-page-overflow evidence, not the static screenshots alone. At768the long ISO input text can exceed its visible input width; the unchanged native editable value remains available and the complete returned interval is readable below. This is not a blocking evidence-loss finding.

## Evidence and limits

Root-run /private/tmp/capital-flow-workbench-green.log reports2passed33.2s, including FLOW-004-A17.8s and retained FLOW-004-B recovery. Reviewed that log, not a self-run Docker result. Root-run predecessor RED log preserves absent new rules-summary failure. Root-run unit log reports118tests/21files passing. Reviewer scoped Biome and strict all-E2E TypeScript passed during acceptance authoring, after correcting an initial tool invocation lacking Node type roots.

No full backend/E2E suite, production deployment, durable preview change, hosted CI, live external provider or broad accessibility/screen-reader/zoom audit was performed by this reviewer. Static source/visual review plus selected runtime evidence supports this frontend slice only, not completion of the whole redesign or product. Root independently owns acceptance-oracle review and release/archival decisions.
