## Context

ManualAccountDetail owns opening revisions, instrument drafts and route guards. TradeJournal owns eligibility, journal mutations, retry identity and cross-editor locks. Financial behavior is already characterized; moving ownership would add avoidable risk.

## Goals / Non-Goals

**Goals:** separate operations, analysis and setup without unmounting their contents; preserve errors, exact values and explicit retry/review; honest initial-position labels; keyboard and narrow-screen usability.

**Non-Goals:** redesign every operation editor, unify analytical dates, add dependencies or change calculations/authentication/API/data/deployment. Retain existing initial fetches; deferred loading needs separate design.

## Decisions

- Add a small presentational AccountWorkspace with three named ReactNode slots. Native buttons with aria-pressed/aria-controls select labelled sections using hidden; no conditional mounting, route change, changing keys or tab-role keyboard contract. Tab/Enter/Space use native behavior, focus remains on the initiating button. Selection is controlled by account-scoped state in ManualAccountDetail so an opening revision can remount the existing journal without unexpectedly changing sections.
- TradeJournal composes operations and analytics in those slots and accepts openingDetails as setup content from its parent. Existing state, effects, keys, callbacks and request guards stay with their owners. CarryIn joins initial data. Account-global errors/conflict notices remain outside sections; journal errors/retry/refresh/receipt stay accessible outside selected contents so uncertain requests can be resolved from any view.
- Keep journal totals/results alongside operations in this slice. Setup shows saved opening positions, revision and boundary with an explicit distinction from current journal lots; no replacement balance is invented.
- Reuse installed React/native CSS and existing theme variables. Prefer this composition over a context/store, duplicated journal instances or URL routes that reset editors.

## Risks / Trade-offs

- Hidden contents continue effects → intentional preservation of current eligibility and request semantics; switching must cause no additional writes or analysis requests.
- CSS can override hidden → local explicit hidden rule and browser visibility checks.
- Opening revision legitimately remounts the journal → keep established lifecycle; presentation switches alone must not remount. Selection stays in the parent and is checked against account identity; it never changes component keys.
- Existing tests expect formerly visible controls → update explicit entry actions only; retain financial/authentication/assertion bodies. Selected real browser cases exercise setup, analytical result, opening guard and frozen trade retry.
- Agent quotas unavailable → no retries or spend; required independent review remains unchecked and blocks archive.

## Migration Plan

Isolated worktree from5099690; specs/tests, real predecessor RED, presentation implementation, scoped checks and synthetic PostgreSQL/browser evidence. No data migration. Local integration only; rollback by reverting this commit. Preview/owner files/volumes remain unchanged. Production remains unauthorized.

## Open Questions

Independent review and owner visual acceptance remain pending. Dedicated operation forms are a later small slice; account navigation does not complete the overall frontend redesign.
