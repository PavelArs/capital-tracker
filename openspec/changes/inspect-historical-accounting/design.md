## Context

The journal already stores immutable versions, a current-head pointer and an optional
immutable known-cost baseline. Its shared FIFO engine uses scale-30 integers and
original lot allocation coordinates. Reusing these is sufficient for a bounded
historical accounting projection. Prices and investor cash flows are separate work.

## Goals / Non-Goals

**Goals:** Exact account quantities, remaining basis and cumulative journal results
at an explicit instant, restated under current effective versions; protected Russian
review and coherent bounded pages without writes or provider calls.

**Non-Goals:** Those listed in the proposal. This is neither an observed balance nor
an audit query for what the application knew at a past wall-clock time. It does not
reconstruct any period before the journal's declared coverage.

## Decisions

### Frozen read contract

`GET /accounting/accounts/:id/trade-journal/history` accepts only `at`, `offset`,
`limit` and `journalRevision`. `at` is required and uses existing `parseAsOf`: an
explicit-offset ISO instant, years1970..9999, at most millisecond precision,
normalized to UTC. Page parsing reuses the existing trade page contract: offset0..9999
(default0), limit1..100 (default50), revision0..10000 required for nonzero offset.
Integers use canonical decimal query strings. Unknown keys, duplicate/array values,
invalid IDs or dates return the existing private accounting400. Valid foreign or
missing account IDs return404. Missing journal, `at < coverageFrom`, mismatching
supplied revision or invalid saved FIFO history return the existing private409.

The exact successful response is:

```ts
{
  accountId: string;
  at: string;
  coverageFrom: string;
  journalRevision: number;
  basis: 'current-effective-history';
  originKind: 'declared-empty' | 'known-cost-carry-in';
  openingRevision: number | null;
  initialCostUsd: string;
  summary: FifoSummary; // All eight existing named fields, no additional fields.
  items: Array<{
    instrumentId: string;
    instrumentName: string;
    instrumentSymbol: string | null;
    quantity: string;
    costUsd: string;
  }>;
  nextOffset: number | null;
}
```

`initialCostUsd` sums baseline carried cost, or is `"0"` for declared-empty. Baseline
cost is not a covered buy, fee, cash flow or realized gain. `summary` is cumulative
from coverage through `at`, not a selected-period or portfolio profit calculation.
Current instrument labels are shown; identity and sorting use canonical UUIDs.
All amounts remain canonical exact strings. No labels/amounts are used as cursors.
`nextOffset` is offset+limit only when more positions follow that page; otherwise it
is null, including empty and out-of-range pages.

### Calculation and consistency

One short read-only REPEATABLE READ transaction owns every account, journal, current
head, label and baseline read through the same EntityManager. Validate account
ownership first. Include non-void current heads with `occurredAt <= at`, including
all ordered executions at the exact boundary. Seed the original immutable baseline
immediately before coverage; never synthesize buys or rebase partial-lot coordinates.
Corrections can move executions across the selected boundary; use the corrected
head's effective time, not its version creation time. Voided heads disappear.

Call the existing FIFO function on that complete prefix, aggregate positive remaining
lots by instrument UUID using BigInt, then sort and page positions. Totals always
describe the complete prefix, including on empty/out-of-range pages. Existing limits
of100 baseline lots,1000 active trades,10000 versions and82 derived atom digits bound
the work. No per-page FIFO, float conversion, SQL numeric aggregation or early limit
that would silently omit a trade. A later request pins the journal revision; a
concurrent write causes409 instead of mixing financial states. Per-response labels
come from that response's database snapshot.

Use a focused historical-accounting service and pure projection function beside the
existing store/FIFO modules, a thin protected controller route, and their module
registration. Preserve all old wire shapes. Reuse existing parsers with an explicit
top-level key allowlist. Avoid extracting a generic reporting framework.

Alternatives considered: persisting derived snapshots needs invalidation/storage;
using today's quantities with old prices is incorrect; an as-known-at audit query
requires a different version-time contract. Existing bounded reconstruction is the
smallest correct slice and needs none of those mechanisms.

### Russian UI and security

Add an isolated account-detail section headed `Учётный срез на дату`, a text input
labelled `Момент времени (ISO, с часовым поясом)` and `Показать учётный срез` action.
Display normalized UTC instant, coverage, journal revision, initial cost, cumulative
totals and a positions table with UUID identity, quantity and FIFO cost. State clearly
that this is reconstruction from the current corrected journal, not market value,
observed balance or investment return. Render labels literally.

No automatic request on each keystroke. Editing the instant or changing the account
invalidates loaded pages and in-flight responses. Every explicit refresh starts at
offset0; continuation retains the original normalized instant and revision. A409
clears pages and requests explicit refresh. Any observed journal-revision change
invalidates the historical view without resetting the parent's unsaved trade draft,
selected correction or consent. Normal loading/empty/error states remain visible.
Late responses cannot restore invalidated content; no browser-storage persistence.

The route inherits real owner/password/MFA admission, no-store, source and quota
controls. Reading does not invoke CSRF setup, business writes, provider calls, session
creation or private logging. Existing authenticated last-seen/admission updates are
accounted for explicitly in acceptance; all accounting rows and original receipts
are unchanged. Existing auth/deployment dependencies and provider quotas are unchanged.

## Risks / Trade-offs

- Restating corrections changes old-date results → label current revision/basis and
  test corrections that change amounts, effective time and void status.
- Coverage can be incomplete → refuse pre-coverage/absent journals; a real known zero
  remains distinct from missing cost. Coverage is declared accounting coverage only.
- Concurrent changes or stale UI responses → RR per response, revision-pinned pages
  and input/account request generations; real PostgreSQL barriers and browser checks.
- Full reconstruction on a read has cost → retain existing strict record bounds and
  quotas; calculate once per request. No new unbounded chart/backfill endpoint.

## Migration Plan

No migration, data rewrite, dependency or deployment change. Implement only after the
carry-in slice is verified and archived. Demonstrate missing API/UI acceptance on
those exact images, implement and independently review, then run source checks and
the full existing PostgreSQL/HTTPS release gate before archival. Reverting this
read-only slice leaves journal data intact; prior carry-in binary compatibility
restrictions still apply. No production deployment is authorized.

## Open Questions

None required for this bounded slice. Baseline amendments, market-price coverage and
performance semantics remain explicitly deferred requirements, not implied here.
