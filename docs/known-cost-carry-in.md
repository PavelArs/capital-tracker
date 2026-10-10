# Known-cost opening lots

> **Endpoints removed (G1 backend, 2026-10-10).** The carry-in endpoints (`/accounting/accounts/:id/trade-journal/carry-in`) were removed (G1 backend); lots already stored keep feeding FIFO, valuation and the exports.

The verified `seed-known-cost-carry-in` slice adds an explicit FIFO origin for an
account whose current opening has known costs for every position. The complete local
release gate passed133/133 HTTPS Chromium cases and real PostgreSQL/migration checks.
See its [verification record](../openspec/changes/archive/2026-09-23-seed-known-cost-carry-in/verification.md)
for actual results and unrun checks.

The owner enters 1..100 original acquisition lots: owned instrument, acquisition
timestamp and order, original quantity, original USD cost including acquisition
fees once, and quantity remaining at the opening. Acquisition cannot be later than
the opening coverage instant. Instrument UUIDs and chronology are explicit;
aggregate opening cost does not reconstruct purchase history.

For original quantity Q, cost C and carried quantity R, prior disposal is Q-R and
prior allocated cost is floor(C*(Q-R)/Q). Calculations use exact scale30 integer
atoms. Carried quantities and remaining costs must match every opening position
exactly; a one-atom mismatch is refused. Known zero cost is allowed. Unknown cost
remains unsupported and never becomes zero. For subsequent cumulative disposal q,
cost allocated from the baseline is floor(C*(D+q)/Q)-A, where D=Q-R and A=floor(C*D/Q).
Successive matches use cumulative differences; final disposal consumes the remaining
carried cost. Original Q/C and residual allocation are preserved.

The owner reviews reconciliation and explicitly acknowledges that the baseline
cannot yet be amended or deleted. Initialization pins the opening revision and
creates journal revision0 without inventing purchases, sales or cash flows. The
baseline precedes covered trades, including those at the coverage instant. Initial
cost is displayed separately from recorded purchases; unconsumed baseline cost is
included in current inventory. Retained opening evidence is not added again to
current journal holdings. Results are accounting figures, not market valuations,
investment returns or tax advice.

Manual corrections, terminal voids and eligible CSV rollback recompute against the
same immutable baseline. Original lots and opening references remain available in
tagged lot/match provenance. The1000-active/10000-version trade caps remain; baseline
lots do not spend those slots. Amending baseline evidence is required later work
with a distinct calculation revision, not an undocumented opening replacement.

After response loss, the full original command and request key survive in-app
refresh, SPA navigation and real authentication recovery. Retry is explicit and
does not create another baseline. A known receipt remains visible if current reads
fail, with new writes blocked until refresh succeeds. This recovery state lasts
only for the current document: full reload, tab closure or browser closure loses
the local unknown command, while accepted server data remains discoverable.

All routes under `/accounting/accounts/:id/trade-journal/carry-in` require full
owner authentication and existing Origin/CSRF/source/quota controls. GET discovers
eligibility/origin; POST `/preview` is read-only; POST initializes or replays;
GET `/lots` returns retained baseline pages. Page limits are1..100/default50, with
exclusive ordinal cursor0..100. Input retains the100KiB JSON envelope. Accounting
operations never request external provider data.

Migration16 is additive: one immutable baseline table and a nullable journal opening
reference with reviewed ownership, finite/range and RESTRICT constraints. Existing
rows are not converted or backfilled. Old application images cannot interpret a
new carry-in origin; do not run mixed old/new binaries or assume binary rollback is
safe after initialization. There is no destructive down migration. No production
migration, deployment, owner-data deletion or repository consolidation has occurred.
