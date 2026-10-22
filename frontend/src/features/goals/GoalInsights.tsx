import { cachedReads } from '@api/cached-reads';
import type { Goal } from '@api/goals.api';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Card, CardHeader } from '@/ui/Card';
import { KeyValue, KeyValueRow } from '@/ui/KeyValue';
import { money } from '../portfolio/format';
import { InlineSkeleton } from '../shell/Skeleton';
import { useCachedRead } from '../shell/useCachedRead';
import { monthsFrom, monthYear, span } from './goal-format';

/** Historical contributions stay nominal, including when the forecast is shown in real terms. */
export default function GoalInsights({ goal }: { goal: Goal }) {
  const terms = JSON.stringify([
    goal.currency,
    goal.expectedReturnPercent,
    goal.targetAmount,
    goal.deadline,
  ]);
  const { data, error, reload, stale } = useCachedRead(cachedReads.goalInsights, goal.id, terms);
  if (!data)
    return (
      <div className="goal-insights">
        {Boolean(error) && (
          <Banner
            tone="warn"
            action={
              <Button size="sm" onClick={() => reload()}>
                Retry
              </Button>
            }
          >
            Could not load contributions and growth.
          </Banner>
        )}
        {['Your contributions', 'Where the growth came from'].map((title) => (
          <Card key={title} label={title} busy={!error}>
            <CardHeader title={title} />
            {error ? (
              <p className="ui-none">Figures are unavailable. Retry to load them.</p>
            ) : (
              <InlineSkeleton label={`Loading ${title.toLowerCase()}`} />
            )}
          </Card>
        ))}
      </div>
    );
  const shown = (value: string | null, signed = false) => money(value, data.currency, signed);
  const maximum = Math.max(1, ...data.months.map((entry) => Math.abs(Number(entry.net ?? 0))));
  // Chart widths only; monetary labels keep the exact strings returned by the server.
  const growthSizes =
    data.growth.contributions !== null && data.growth.market !== null
      ? [Math.abs(Number(data.growth.contributions)), Math.abs(Number(data.growth.market))]
      : null;
  const barTotal = growthSizes?.reduce((sum, size) => sum + size, 0) ?? 0;
  const negativeGrowth = [data.growth.contributions, data.growth.market].some(
    (value) => value !== null && Number(value) < 0,
  );
  const pace = data.paceReachedOn;
  const deadline = goal.deadline;
  const paceGap =
    pace && deadline && pace > data.asOf
      ? pace === deadline
        ? 'On the date'
        : `${span(monthsFrom(pace < deadline ? pace : deadline, pace < deadline ? deadline : pace))} ${pace < deadline ? 'before' : 'after'} the date`
      : null;
  return (
    <div className="goal-insights">
      {stale && (
        <Banner
          tone="warn"
          role="alert"
          action={
            <Button size="sm" onClick={() => reload(true)}>
              Retry
            </Button>
          }
        >
          Could not refresh contributions and growth; showing the last loaded figures.
        </Banner>
      )}
      {!data.complete && (
        <Banner tone="info">
          Priced assets only. Missing prices, rates or account history make these figures
          incomplete.
        </Banner>
      )}
      <Card label="Your contributions">
        <CardHeader title="Your contributions" sub="Money put in minus money taken out" />
        <p className="ui-sub">
          Full months only. Averages need all 3, 6 or 12 months of tracked history. Figures are
          nominal, at each flow’s exchange rate.
        </p>
        {data.months.length > 0 ? (
          <>
            <div
              className="goal-month-bars"
              role="img"
              aria-label="Net contributions by completed month"
            >
              {data.months.map((entry) => (
                <span
                  key={entry.month}
                  title={`${monthYear(`${entry.month}-01`)}: ${shown(entry.net, true)}`}
                >
                  <i
                    data-negative={entry.net?.startsWith('-') || undefined}
                    data-missing={entry.net === null || undefined}
                    style={{
                      height: `${entry.net === null ? 100 : Math.max(2, (Math.abs(Number(entry.net)) / maximum) * 100)}%`,
                    }}
                  />
                  <small>{entry.month.slice(5)}</small>
                </span>
              ))}
            </div>
            <details className="goal-note">
              <summary>Monthly amounts</summary>
              <KeyValue>
                {data.months.map((entry) => (
                  <KeyValueRow key={entry.month} term={monthYear(`${entry.month}-01`)}>
                    {shown(entry.net, true)}
                  </KeyValueRow>
                ))}
              </KeyValue>
            </details>
          </>
        ) : (
          <p className="ui-none">No full month of tracked history yet.</p>
        )}
        <KeyValue>
          {([3, 6, 12] as const).map((count) => (
            <KeyValueRow key={count} term={`Last ${count} months`}>
              {shown(data.averages[count])} <span className="ui-sub">a month</span>
            </KeyValueRow>
          ))}
          <KeyValueRow term="At your 6-month pace">
            {data.paceReachedOn
              ? data.paceReachedOn <= data.asOf
                ? 'Reached'
                : monthYear(data.paceReachedOn)
              : data.paceStatus === 'insufficient-history'
                ? 'Not enough history'
                : data.paceStatus === 'beyond-horizon'
                  ? 'Not reached within 100 years'
                  : 'No current priced value'}
            {paceGap && (
              <span
                className="goal-pace-gap"
                data-late={(pace && deadline && pace > deadline) || undefined}
              >
                {paceGap}
              </span>
            )}
          </KeyValueRow>
        </KeyValue>
        <p className="ui-sub">
          Estimated with your expected return and the average net contribution of the last six full
          months.
        </p>
      </Card>
      <Card label="Where the growth came from">
        <CardHeader title="Where the growth came from" sub="Last 12 months" />
        {growthSizes && barTotal > 0 ? (
          <div
            className="goal-growth-bar"
            role="img"
            aria-label={`You put in ${shown(data.growth.contributions, true)}; Market ${shown(data.growth.market, true)}${negativeGrowth ? '; segment widths show movement sizes, not shares of net growth' : ''}`}
          >
            <span
              aria-hidden="true"
              data-part="contributions"
              data-negative={data.growth.contributions?.startsWith('-') || undefined}
              style={{ width: `${(growthSizes[0] / barTotal) * 100}%` }}
            />
            <span
              aria-hidden="true"
              data-part="market"
              data-negative={data.growth.market?.startsWith('-') || undefined}
              style={{ width: `${(growthSizes[1] / barTotal) * 100}%` }}
            />
          </div>
        ) : (
          <p className="ui-none">
            {growthSizes
              ? 'No contributions or market movement in this period.'
              : 'Growth breakdown is unavailable.'}
          </p>
        )}
        {negativeGrowth && (
          <p className="ui-sub">
            Segment widths show movement sizes. Withdrawals and market losses are shown in red.
          </p>
        )}
        <KeyValue>
          <KeyValueRow term="You put in">{shown(data.growth.contributions, true)}</KeyValueRow>
          <KeyValueRow term="Market">{shown(data.growth.market, true)}</KeyValueRow>
          <KeyValueRow term="Net worth grew by">{shown(data.growth.total, true)}</KeyValueRow>
        </KeyValue>
        <p className="ui-sub">
          Nominal growth over the available history
          {data.growth.from ? ` since ${monthYear(data.growth.from.slice(0, 10))}` : ''}. Market
          includes interest and rewards. Growth includes opening basis when it entered tracked
          history; savings averages exclude it. Missing historical prices or rates remain unknown.
        </p>
      </Card>
    </div>
  );
}
