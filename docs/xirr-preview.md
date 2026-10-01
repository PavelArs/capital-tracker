# Annual XIRR preview

Implemented and verified with targeted numerical, PostgreSQL and real HTTPS
checks. See the [verification record](../openspec/changes/archive/2026-09-23-preview-conventional-xirr/verification.md).
This is a limited manual preview; automatic valuations and general cash-flow
patterns remain outside its supported scope.

The XIRR action on **Прибыль за период** estimates an annualized rate from the
reviewed manual opening and closing portfolio values and the owner-declared USD
flow journal. It is an approximate historical rate, not a forecast or financial
advice. The existing profit action and
[`/accounting/portfolio/profit-preview`](period-profit-preview.md) contract stay
unchanged.

At the beginning, treat portfolio value as a negative investor cash flow; treat
contributions as negative and withdrawals as positive. Treat closing value as a
positive investor cash flow. Both valuations are immediately before flows at their
respective boundaries, and the interval is `[from,to)`: a flow at the start is
included, while a flow at the end is excluded. The supplied contribution example
of 1000 at the start of a year, with opening value 0 and closing value 1100 after
one year, produces exact profit 100 and an annual XIRR near 10%.

The calculation uses all effective corrected flows in the selected period. Flows
with the same UTC millisecond instant are aggregated exactly before zero totals are
discarded. It uses ACT/365F, with elapsed time measured in UTC milliseconds. The
XIRR equation and date-based definition are described by
[Microsoft XIRR](https://learn.microsoft.com/en-gb/dax/xirr-function-dax); this
preview's millisecond convention differs from Excel's integer-date convention
([Excel XIRR](https://support.microsoft.com/en-us/Excel/functions/xirr-function)).

Only conventional cash-flow sequences are supported: there must be at least two
nonzero dates, both signs, and one transition from negative flows to positive
flows. Up to 64 nonzero dates are supported, including the valuation boundaries;
records are never silently truncated. The annual rate range is inclusive from
`-0.999999` to `1000`. The rate is approximate to an absolute annual-decimal
tolerance of `1e-10`; very small rates may round to zero. With at least two nonzero
effective instants, a span from the first to the last of less than 365 actual days
makes the period short, even when the selected window itself is longer. Annualization over a short period can
be especially sensitive to small valuation or timing differences and is not a
forecast.

When the supported calculation cannot return a rate, it returns no numeric rate
or percentage and supplies one reason: `insufficient-cash-flows`,
`one-sided-cash-flows`, `unsupported-pattern`, `too-many-cash-flow-dates`,
`outside-supported-range`, or `numerical-failure`. An unsupported sign pattern is
a conservative eligibility decision; it does not prove that no root exists or
that several roots exist.

## API and privacy

Authenticated `POST /accounting/portfolio/xirr-preview` uses the same reviewed
input as the profit preview: UTC `from` and `to`, nonnegative decimal-string
`openingValueUsd` and `closingValueUsd`, and `assertReviewed: true`. It returns
the existing exact profit result plus XIRR status, annual decimal rate, annual
percent, convention, tolerance, date count, short-period flag, and—when
unavailable—a reason. Profit and rate come from the same owner-scoped,
read-only repeatable-read snapshot. The database transaction ends before numerical
solving. The existing profit endpoint's response does not gain XIRR fields.

The endpoint retains the existing owner authentication, completed MFA, CSRF,
Origin and private no-store requirements. Missing coverage or a start before the
journal boundary is an error. It does not save valuations or results, infer prices,
read trade costs or household income, or call external providers. One XIRR request
may be active per backend process; excess concurrent requests receive `429` and
are not queued. This limit applies separately to each replica, not globally.

The implementation uses the runtime dependency
[`decimal.js` 10.6.0](https://mikemcl.github.io/decimal.js/) for approximate rate
math while retaining money amounts as exact strings/atoms.
