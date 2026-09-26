## Context

TradeJournal owns existing trade drafts/guards and composes swap, reward and CSV controllers. Those children already preserve ambiguous commands across permitted navigation. AccountWorkspace keeps the overall operations/analysis/setup sections mounted.

## Goals / Non-Goals

**Goals:** select one operation workflow without resetting state, hiding shared results or bypassing explicit review/retry. Preserve native keyboard behavior, exact evidence and narrow-screen usability.

**Non-Goals:** replace financial controllers, merge histories, change calculations, introduce a component library, auto-submit or update the preview.

## Decisions

- Add a presentational AccountOperations with a labelled native select and four persistent hidden containers. Control selection in TradeJournal, initially trades. Native select avoids another custom tab row and keyboard contract; no route/context/store is needed.
- Keep existing component identity, props, effects, guards and request recovery. Render TradeResults after the selected workflow, always available within account operations. Existing correction/void callbacks also select the trade view; they never submit or bypass their existing guards. Shared journal errors/recovery remain outside both selectors.
- Selecting a workflow retains each editor's feedback/review/retry, visible again on return. Swap/reward/CSV recovery after SPA return requires selecting that workflow explicitly; original commands remain in their existing owners. No auto-retry, reset, cancellation or deferred loading is added.
- Local CSS uses current themes, contained width and the native hidden attribute. Existing custom editor CSS remains scoped; no lock or deployment edits.

## Risks / Trade-offs

- Hidden controllers continue their existing effects → intentional preservation; verify no extra reads/writes caused by selection and no dropped independent drafts.
- CSV recovery still blocks trade writes when hidden → retain callback/lock lifecycle and test actual committed-response recovery; selection must not be treated as cancellation.
- Existing tests assume simultaneous visibility → add explicit selection around actual actions; exact value checks may inspect deliberately hidden mounted form nodes, with financial oracles unchanged.
- Agent quotas unavailable → no retry/spend; root integration inspection cannot satisfy independent review, which blocks archive.

## Migration Plan

Worktree from3ad13f7, specs and actual predecessor browser RED before product edits, scoped implementation, retained characterization and real PostgreSQL/browser checks. No data migration. Revert the frontend commit to roll back. Existing deployment pipeline, protected owner Nginx and isolated persistent preview remain untouched.

## Open Questions

Independent review and owner visual acceptance remain outstanding. Detailed form ergonomics, shared result hierarchy and the other frontend screens remain separate slices.
