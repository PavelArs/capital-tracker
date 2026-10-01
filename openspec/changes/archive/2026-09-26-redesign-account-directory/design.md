## Context

At60ee94e, ManualAccounts owns account loading, cursor paging, creation name and
request-ID retry state. ManualPortfolioValuation owns selection, time, result and
stale-response generation. Existing APIs return exact strings and private owned data.
The previous shell slice already supplies responsive navigation/theme/focus.

## Goals / Non-Goals

**Goals:** Lead with saved accounts; expose creation and selected valuation deliberately;
keep drafts and exact backend behavior; fit360/768/1440px without hiding evidence.

**Non-Goals:** Account-detail/editor replacement, search, new backend/data model,
new library, new valuation result, complete FUI delivery or production deployment.

## Decisions

### Preserve state ownership and mounted forms

Use a labelled button and inline hidden section for creation, not a modal. It needs
no overlay, focus trap or new dependency. Focus the name field on opening; close and
Escape return focus to the trigger. Keep the section mounted and retain name/error/
request ID across collapse. Success clears the name, closes the form and exposes the
existing created-account link outside it. A failed response keeps the draft available.
No navigation/width/disclosure effect submits a request. Keep existing create/retry
normalization and API contracts; do not introduce a second copy of form state.

### Keep valuation available in the same page

A native details/summary disclosure follows the directory, with a short honest manual
subset description. The existing valuation component stays mounted, including its
selection/time and response generation. Collapse only hides it; route departure still
unmounts and invalidates pending results. This is clearer than another permanent large
form, and avoids introducing a new route/data loader in this small slice.

### Isolate layout styles

Add a page-specific account-directory stylesheet; do not restyle every shared
manual-card/form used by editors. Use the shell palette, compact list rows, long-name
wrapping and small borders. Keep technical revision available as secondary metadata.
Show loaded count, not a fabricated all-account count when a cursor remains. Correct
only the valuation checkbox sizing that currently inherits global text-input width.

## Risks / Trade-offs

- Hidden inputs lose draft/retry identity → keep DOM and state mounted; real lost
  committed response plus hide/reopen/retry must return the same account, no duplicate.
- Success account is beyond the first catalog page → preserve a visible success link
  independent of the loaded list; verify actual exclusive-cursor pagination.
- Valuation collapse changes intent accidentally → retain exact totals/gaps/stale
  response assertions and verify selection/time/result survive collapse.
- Shared CSS affects unchanged editors → scoped selectors and existing unit/build gates;
  no accounting formatter/parser or backend edits.
- Agent quotas remain unavailable → do not claim independent review or archive. No
  repeated quota retries or paid fallback.

## Migration Plan

No schema, deployment pipeline, provider quota or authentication change. Build only
the frontend acceptance image after genuine RED; verify with retained backend and
synthetic PostgreSQL. A frontend rollback leaves data intact. Preserve owner Nginx,
lockfile, original repositories and the separately saved preview volume/image.

## Open Questions

None blocks this bounded slice. Account/editor information architecture, full valuation
UX, maximum chart period and owner visual review remain separate backlog work.
