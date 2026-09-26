## Context

Base859f267 has no active changes and retains the owner's unrelated Nginx edit. Read-only inventory: `/private/tmp/capital-movement-inventory.md`. Keep controllers, exact strings, review generation guards, locked account pair, receipts/recovery, allocations, versions and real authentication. Simplify flat field grouping and UUID-led visual hierarchy. Remove no persisted data, code folders, tests or supported capabilities.

CI/CD and synthetic Compose were inspected: production is still manually gated by PRODUCTION_ROLLOUT_ENABLED and release hardening is unfinished. This frontend slice does not replace or enable that pipeline.

## Goals / Non-Goals

**Goals:** grouped transfer entry, useful associated guidance, clear required review step, focused history editing and restrained responsive presentation.

**Non-Goals:** external USD flows, transaction economics/API changes, financial validation changes, dependency migration, whole frontend completion, production or preview rollout.

## Decisions

- Reuse OperationForm.css with useId descriptions outside labels; preserve all values, handlers, required/disabled expressions and option identities. Native controls avoid an unnecessary UI dependency migration in this bounded step.
- Root owns OwnedTransfers navigation and scoped CSS; a Luna worktree owns only OwnedTransferForm. Separate Sol acceptance worktree extends existing TRANSFER-UI. Independent review challenges guards, descriptions, focus and evidence.
- An event-only layout effect focuses the persistent heading after React renders the selected mode, without waiting for review. The request is issued only after the existing staging guards. Cancel preserves existing reset semantics then focuses the stored live enabled origin or the heading. Asynchronous review does not focus anything.
- Keep article accessible identity for stable selection; lead visible heading with amount/asset or cancelled state. Native details retains full identity without custom disclosure state. Existing allocation/version loaders and receipts remain unchanged.
- Add only transfer-scoped CSS, readable foreground tokens, flexible grids and contained table overflow. No global/shared CSS changes required.

## Risks / Trade-offs

- Financial ambiguity → exact recipient/fee/time guidance and retained existing economic/retry assertions; never convert amount strings for layout.
- Focus moved by late review → focus only in synchronous user actions; verify with held real responses if needed, never fabricate backend responses.
- Long IDs/asset names and nested tables → min-width:0, wrapping IDs and contained table scroll; inspect actual viewport screenshots without hiding the skip link.
- Dark text contrast → use existing foreground token `--primary-color-dark`, not button-background `--primary-color`, for links/disclosures/focus.
- Visual improvement is bounded; flow editor, analytical/settings screens and whole-redesign owner approval remain open.

## Verification and rollout

Baseline frontend118 tests; retain passing characterization. Write acceptance first and show RED on the previous tested frontend image for the new focus/descriptions. Then run frontend tests/build/lint, strict E2E TypeScript, scoped formatter, production audit and strict OpenSpec validation. Selected real E2E: TRANSFER-UI (all new scenarios plus actual create response loss/exact retry, correction, void and original fee/holdings assertions) and WORKFLOW-UI (shared presentation characterization). Root alone controls synthetic capital-tracker-e2e, HTTPS/password/MFA/backend/PostgreSQL22 migrations and artifact gates; providers only use fixtures. Full backend/E2E, upgrade matrix, scanners, live providers and production release remain unrun this slice.

No migration, new quota, network dependency or persisted state. Rollback is the frontend commit/image only. Preserve owner Nginx/lock hashes, original worktrees and durable preview; remove only this run's disposable E2E resources and dependency symlinks. Archive after review and recorded passing required gates, then compare canonical delta blocks and untouched specs before integrating.
