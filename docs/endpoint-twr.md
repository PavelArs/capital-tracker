# Endpoint TWR preview

> **Retired screen (M20, 2026-10-08):** the TWR preview lived on `/period-profit`, which now opens the Dashboard; it is hidden in the new interface (Q10) and its API stays until a separate removal.

This bounded preview adds a period return to the existing manual USD profit/XIRR
form. Values and results are temporary. It is not automatic portfolio valuation,
complete linked TWR, or a tax/GIPS compliance report.

The owner supplies reviewed opening/closing total USD values, including tracked
cash once, and a period covered by the external-flow journal. Opening is just before
flows at the lower boundary; closing is just before flows at the excluded upper
boundary. All effective owner flows are loaded in one read-only repeatable-read
snapshot, including accepted corrections and excluding voided heads.

Flows at one UTC millisecond are simultaneous. Their contributions minus withdrawals
are netted exactly. Opening capital is opening value plus the net flow at the start.
If there is no nonzero net flow at any strictly interior instant, and adjusted opening
capital is positive, period return is `(closing / adjustedOpening) - 1`.

Examples:

- Opening0, contribution1000 at the start, closing1100: profit100, period return10%.
- Opening1000, no flows, closing0: loss1000, period return-100%.
- Opening1000, interior contribution1000, closing2000: exact profit0 is available;
  TWR is unavailable because the value at the contribution boundary is missing.
- Equal opposite flows at the same millisecond cancel; flows one millisecond apart
  require separate valuations and cannot cancel for this calculation.

The general TWR method uses valued subperiods and geometric linking; this endpoint
case is a restricted application of that method. See the official
[GIPS Handbook](https://www.gipsstandards.org/standards/gips-standards-for-firms/gips-standards-handbook-for-firms/),
checked2026-09-24. Supporting intermediate valuations and linked TWR is future work.

## API and precision

`POST /accounting/portfolio/twr-preview` accepts exactly the reviewed profit inputs
`from`, `to`, `openingValueUsd`, `closingValueUsd`, `assertReviewed:true`. Existing
48 integer/30 fractional decimal input limits, explicit-zone timestamps, private
session/MFA/CSRF/origin/no-store protection and coverage409 apply. Results return
exact profit data plus `twr` with method, adjusted opening, net start flow, count of
interior nonzero-net instants, status/reason and period rate/percent strings.

Unavailable reasons are `missing-flow-boundary-valuations`, then
`nonpositive-opening-capital` when no intermediate valuation is missing. Unavailable
rates are null. A supported flat positive-capital period returns string0.

Money uses exact integers throughout. Only the final rational rate is rounded to12
fractional places, nearest with ties away from zero; percent is100 times that
published rate. The absolute decimal-rate rounding bound is0.0000000000005. This
bound describes arithmetic, not accuracy of manually supplied valuations. Very
small gains/losses may round to0. The result is for the selected period and is not
annualized. The manual/unreconciled data caveat remains visible.

The explicit browser action clears old results on input changes, new calculations,
errors and lost authentication. Late replies cannot restore edited results. No
preview data is stored, no provider is called and no migration is introduced.
See the [archived verification record](../openspec/changes/archive/2026-09-24-preview-endpoint-twr/verification.md) for actual test evidence.
