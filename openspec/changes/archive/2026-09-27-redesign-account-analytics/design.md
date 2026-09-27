## Context

Basec3a4dbd has42canonical specifications and no other active change. AGENTS, target
redesign direction, continuity, current historical/valuation/chart/workspace specs and
the manually gated CI/CD were inspected. The three original analytic owners are
siblings under AccountWorkspace, always mounted; each reads only on explicit submit.
ManualAccountDetail already keys TradeJournal by account identity/opening revision.

Keep: original controllers/generations, exact strings and financial distinctions,
read guards/pagination, mounted operation drafts, timestamp text inputs, all evidence,
chart transforms/options and30elapsed-day/31point bounds, auth/quota/pipeline.
Simplify: one chosen task, short visible scope, associated field help, result-first
hierarchy and native method disclosure, consistent token-based presentation.
Remove: duplicated per-tool presentation CSS after consolidating scoped styles;
no supported behavior, financial evidence or tests. Separately, the owner explicitly
authorized removing proven merged worktrees; active worktrees/data remain protected.

## Goals / Non-Goals

**Goals:** useful account-analysis choice and retained exact intent/results, readable
controls/tables/provenance on mobile/tablet/desktop in both themes.
**Non-Goals:** accounting/API/auth/schema/provider changes, range expansion, chart
algorithm changes, aggregate portfolio redesign, production/preview rollout.

## Decisions

- New AccountAnalytics owns only local selection and useId; a native labeled select
  defaults to valuation, then history or accounting. Options have concise Russian
  names: selector Задача анализа, options Оценка на дату / История стоимости / Учётные
  позиции. Three original children stay mounted under hidden wrappers with stable keys;
  no conditional mounting or new owner key. Selection cannot issue an API request.
  Existing outer account key handles identity reset. A selector avoids three expanded
  tasks competing for attention and works with standard keyboard/mobile controls.
- Root owns AccountAnalytics.tsx, TradeJournal composition and three read-tool TSX
  presentations. Luna owns AccountAnalytics.css and removes three obsolete CSS files
  only after imports move. Sol owns affected E2E acceptance/preconditions. Separate
  source/oracle review; root alone owns Docker, integration, dependencies and archive.
- Preserve original section/heading/input/action/table names. Use useId-associated
  help, native details for complete original methodology, and a concise always-visible
  statement of cost-versus-value/scope/30day sampling. No timestamp normalization or
  new date defaults. Default native closed disclosure requires no extra React state.
- Reorder complete valuation/subtotal and original accounting totals/positions before
  secondary coverage/revision/origin metadata. Nothing is dropped or recomputed.
  Historical chart still shows only complete points with exact table/tooltips.
- Give each existing table wrapper a distinct named region, tabIndex0 and visible
  focus/contained horizontal scroll. Original table/cell order and pagination stay.
  Shared analytics classes scope styles to this component and use current theme tokens,
 44px inputs/actions, min-width0 and readable exact-value wrapping. Chart keeps its
  own bounded height; no animation/algorithm change in this slice.

## Risks / Trade-offs

- Hidden panel remount loses results → retain all child nodes; real task switching
  asserts node/input/result identity, request counters and separate trade draft.
- Late response arrives while another task is selected → original generations remain;
  response does not select a task or move focus, and edited intent still invalidates it.
- Existing browser prerequisites expect all tasks visible → explicitly select needed
  task in every affected journey; never weaken stale/financial/assertion visibility.
- Tables become inaccessible on small screens → named focused scroll area plus real
  keyboard scroll/full exact-cell assertions and actual360/768/1440 light/dark frames.

## Verification and rollback

Existing118frontend baseline before edits. Acceptance-first actual predecessor RED
on focused task visibility/selector; preserve passing characterization for layout.
Required real selected journeys: WORKSPACE-UI (mounted drafts/results/retry), HIST-004-A
late-response journey, pinned-history pagination (result presentation), VAL-UI and
VCH-UI. Existing simple/account-switch preconditions also updated and typechecked;
no financial assertions removed. Directory MPV-UI unchanged/unrun because its styles
and composition are untouched. Use real HTTPS/password/MFA/backend/PostgreSQL22
migrations and tested images; only external providers use fixtures.

Run frontend tests/build/lint, strict all-E2E types, scoped Biome, production audit,
strict OpenSpec and original-controller/control preservation review. Record real visual
frames and limits; no full E2E/backend/API/upgrade/provider/security/release claim.
No migration/quota/data impact; rollback is frontend only. After review/verification,
archive and compare42existing canonical files plus3new requirement blocks, then guarded
integration and authorized disposable worktree cleanup. Preserve owner Nginx/lock and
durable preview volume/MFA/TLS/credentials/images.
