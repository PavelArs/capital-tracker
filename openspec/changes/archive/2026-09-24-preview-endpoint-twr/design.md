## Context

The existing profit/XIRR previews use reviewed manual total USD valuations, complete
owner-declared external-flow heads and one RR READ ONLY snapshot. This first TWR
slice uses those endpoints only; it does not manufacture intermediate valuations.
The official GIPS Handbook describes flow-boundary subperiod valuation and geometric
linking. Our bounded case collapses to one endpoint ratio when no interior instant
has net external flow. This is a design inference, not a GIPS compliance claim.
Reference checked2026-09-24: https://www.gipsstandards.org/standards/gips-standards-for-firms/gips-standards-handbook-for-firms/

## Goals / Non-Goals

**Goals:** compute a useful supported period return with explicit missing-data
states, preserve exact financial amounts and reuse the existing private snapshot/UI.
**Non-goals:** general linked TWR, intermediate valuation entry, annualization,
automatic portfolio/cash pricing, saved results, charts, providers or schema changes.

## Decisions

1. POST `/accounting/portfolio/twr-preview` accepts exactly the existing
   `ProfitPreviewInput`: from/to, openingValueUsd/closingValueUsd, assertReviewed:true.
   Reuse `parseProfitPreview` and `valuationSnapshot`; no browser flow pagination.
   Return the unchanged exact profit payload plus `twr`. Snapshot ends before pure
   arithmetic. Existing owner/MFA/CSRF/origin/no-store/request-limit rules apply.
2. Group every effective eligible flow by canonical UTC millisecond, contributions
   positive and withdrawals negative using scale30 BigInt atoms. The interval is
   `[from,to)`: opening is before all flows at from; closing before those at to.
   `netFlowAtStartUsd` is signed net at from; `startingCapitalUsd` is opening plus
   this net. `interiorNetFlowDateCount` counts strictly interior instants whose
   aggregated net is nonzero. Same-ms cancellation is simultaneous by convention.
3. With any such interior instant: unavailable `missing-flow-boundary-valuations`.
   Otherwise with adjusted start <=0: unavailable `nonpositive-opening-capital`.
   This precedence is deterministic. Both return null rate/percent, never a zero
   placeholder. Exact profit, revision, diagnostics and completeness still return.
4. Otherwise rate=(closing-startingCapital)/startingCapital. Round the exact BigInt
   rational once to12 fractional places, nearest with ties away from zero. Percent
   is exactly100 times that published rate. Canonical strings, no negative zero.
   Max absolute decimal-rate rounding error0.0000000000005 concerns arithmetic only,
   not valuation accuracy. Zero terminal is valid -100%; short periods are not
   annualized. Existing bounded journal (<=1000 active heads, input48/30 precision)
   keeps this linear grouping and integer division small; no iterative solver/slot.
5. Frozen twr payload fields: `method:'endpoint-ratio-UTC-ms'`,
   `rateRoundingBound:'0.0000000000005'`, `netFlowAtStartUsd:string`,
   `startingCapitalUsd:string`, `interiorNetFlowDateCount:number`, `status`,
   `reason`, `periodRate`, `periodPercent`. Available reason null and string rates;
   unavailable reason as above and null rates. No extra fields required.
6. Extend existing PeriodProfit mode union with twr, API client and explicit
   `Рассчитать TWR` action. Region/heading `Доходность TWR`, value label `TWR, % за период`.
   Explain manual/unreconciled valuations, period-only rounding, simultaneous flows
   and the endpoint limitation. Missing-flow message:
   `Для расчёта TWR нужны оценки в моменты промежуточных вводов и выводов.`
   Nonpositive message: `Начальный капитал после потоков должен быть положительным.`
   Reuse generation/auth/unmount guards; any edit/new action/error clears old result
   and editing resets review. Never auto-submit or persist drafts/results.

## Risks / Trade-offs

- Manual endpoints are not independently verified balances → disclose manual and
  unreconciled basis and do not imply complete automated performance.
- Interior netting must not lose tiny amounts or merge distinct milliseconds →
  exact unit/PG oracles include cancellation, one atom and adjacent instants.
- Concurrent correction could mix state → actual two-connection RR test and next
  preview revision/result checks. No new snapshot implementation is introduced.
- Additional button may regress existing modes → retain original XIRR UI case.

## Migration / rollback / verification

No migration, dependency, external quota or production action. Keep current GHCR,
Compose and guarded manual rollout. Rollback is a source revert; no data changes.
Baseline profit/XIRR82tests/2suites pass. Keep current accounting and UI components,
simplify by sharing their validation/snapshot/form, remove nothing in this slice.

Risk-based checks: pure arithmetic/strict-input characterization, real PG full heads,
RR correction/ownership/read-only fingerprints, two new HTTPS cases TWR-API/TWR-UI
and retained XIRR-UI, relevant unit/lint/build/types, production advisory gate and
strict OpenSpec. Do not run full E2E/full backend/older migration matrix/release or
production checks for this additive bounded slice. Root owns Docker/shared runners.
