import { cachedReads } from '@api/cached-reads';
import {
  type AccountingCurrency,
  type LotAfterInflation,
  type LotReading,
} from '@api/portfolio-valuation.api';
import { useEffect, useRef } from 'react';
import { ListRowText, rowClass } from '@/ui/ListRow';
import { useNarrowScreen } from '@/ui/useMediaQuery';
import { dayText } from '@/utils/dates';
import { basisText } from '../shell/basis-text';
import { type InflationBasis, useInflationBasis } from '../shell/inflation-basis';
import { InlineSkeleton } from '../shell/Skeleton';
import { useCachedRead } from '../shell/useCachedRead';
import { Signed } from './asset-parts';
import { DASH, money, percent, quantity, tone } from './format';
import './portfolio.css';

/** Two lots of one account can share an instant, so a repeat gets a number to keep keys unique. */
function keyed(lots: readonly LotAfterInflation[]): [string, LotAfterInflation][] {
  const seen = new Map<string, number>();
  return lots.map((lot) => {
    const base = `${lot.accountId}:${lot.acquiredAt}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return [count === 0 ? base : `${base}:${count}`, lot];
  });
}

const readingOf = (lot: LotAfterInflation, basis: InflationBasis): LotReading | null =>
  lot.real[basis];

/**
 * The basis line over the table: the money the readings are in and what they rest on, said once
 * for the whole card.
 */
function basisLine(
  lots: readonly LotAfterInflation[],
  basis: InflationBasis,
  currency: AccountingCurrency,
): string | null {
  const readings = lots.flatMap((lot) => readingOf(lot, basis) ?? []);
  if (readings.length === 0) return null;
  return `In today's ${currency}, ${basisText(
    basis,
    {
      estimated: readings.some((reading) => reading.estimated),
      ownRate: readings.every((reading) => reading.ownRate !== false),
    },
    currency,
  )}`;
}

function RealProfit({
  reading,
  currency,
}: {
  reading: LotReading | null;
  currency: AccountingCurrency;
}) {
  return (
    <>
      {reading === null ? (
        DASH
      ) : (
        <Signed
          value={reading.unrealizedPnl}
          currency={currency}
          ratio={reading.unrealizedReturnPercent}
          inline
        />
      )}
    </>
  );
}

function LotsTable({
  lots,
  basis,
  currency,
}: {
  lots: readonly LotAfterInflation[];
  basis: InflationBasis;
  currency: AccountingCurrency;
}) {
  return (
    <div className="ui-table-wrap">
      <table className="ui-table" aria-labelledby="asset-lots">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col" className="ui-num">
              Amount
            </th>
            <th scope="col" className="ui-num">
              Paid
            </th>
            <th scope="col" className="ui-num">
              Inflation since
            </th>
            <th scope="col" className="ui-num">
              Paid in today&apos;s money
            </th>
            <th scope="col" className="ui-num">
              Value now
            </th>
            <th scope="col" className="ui-num">
              Real P&amp;L
            </th>
          </tr>
        </thead>
        <tbody>
          {keyed(lots).map(([key, lot]) => {
            const reading = readingOf(lot, basis);
            return (
              <tr key={key}>
                <td>
                  {dayText(lot.acquiredAt)}
                  <span className="portfolio-sub">{lot.accountName}</span>
                </td>
                <td className="ui-num">{quantity(lot.quantity)}</td>
                <td className="ui-num">{money(lot.paid, currency)}</td>
                <td className="ui-num">
                  {reading === null ? DASH : percent(reading.inflationPercent)}
                </td>
                <td className="ui-num">
                  {reading === null ? DASH : money(reading.costBasis, currency)}
                </td>
                <td className="ui-num portfolio-strong">{money(lot.value, currency)}</td>
                <td className="ui-num">
                  <RealProfit reading={reading} currency={currency} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Phones get two-line rows instead of the table (design: tables on phones).
function LotsList({
  lots,
  basis,
  currency,
}: {
  lots: readonly LotAfterInflation[];
  basis: InflationBasis;
  currency: AccountingCurrency;
}) {
  return (
    <ul className="ui-rows">
      {keyed(lots).map(([key, lot]) => {
        const reading = readingOf(lot, basis);
        const paid =
          lot.paid === null
            ? ''
            : reading === null
              ? ` · paid ${money(lot.paid, currency)}`
              : ` · paid ${money(lot.paid, currency)} → ${money(reading.costBasis, currency)} (${percent(reading.inflationPercent)})`;
        return (
          <li key={key} className={`${rowClass()} portfolio-lot`}>
            <ListRowText
              title={dayText(lot.acquiredAt)}
              detail={`${lot.accountName} · ${quantity(lot.quantity)}${paid}`}
              amount={money(lot.value, currency)}
              value={
                reading === null ? (
                  DASH
                ) : (
                  <span
                    className={
                      tone(reading.unrealizedPnl)
                        ? `portfolio-${tone(reading.unrealizedPnl)}`
                        : undefined
                    }
                  >
                    {money(reading.unrealizedPnl, currency, true)}
                    {reading.unrealizedReturnPercent !== null &&
                      ` · ${percent(reading.unrealizedReturnPercent)}`}
                  </span>
                )
              }
            />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The held purchases of one asset, each carried to today by the inflation since its day
 * (INFL-REAL-LOTS), on the basis the owner chose. Loaded on its own so the asset page does not
 * wait for it and the cached portfolio answer stays small.
 */
export default function AssetLotsCard({
  instrumentId,
  asked,
  values,
}: {
  instrumentId: string;
  asked: AccountingCurrency | undefined;
  /** What the page shows of the asset: a change (a saved price) asks for the lots again. */
  values: string;
}) {
  const phone = useNarrowScreen();
  const [basis] = useInflationBasis();
  const read = useCachedRead(cachedReads.assetLots, instrumentId, asked);
  // `stale`: a refresh failed and the figures on screen may be out of date. The cache keeps that
  // with the figures, so it stays until an answer replaces them, also when the card is shown
  // again or the page is reloaded.
  const { data: answer, error, stale, reload } = read;
  // A saved price changes the values, so the lots are asked again. A refreshed portfolio that shows
  // the same values does not: the mount already asked, so only a change of `values` asks.
  const shownValues = useRef(values);
  useEffect(() => {
    if (shownValues.current === values) return;
    shownValues.current = values;
    reload(true);
  }, [values, reload]);

  const line = answer ? basisLine(answer.lots, basis, answer.currency) : null;
  return (
    <section className="shell-card" aria-labelledby="asset-lots">
      <div className="ui-toolbar">
        <h2 id="asset-lots">Purchases after inflation</h2>
        {line && <span className="portfolio-sub">{line}</span>}
      </div>
      {error !== null && answer === null ? (
        <div className="portfolio-state" role="alert">
          <p>Could not load the purchases. Your data is safe; try again.</p>
          <button type="button" className="shell-button" onClick={() => reload(true)}>
            Try again
          </button>
        </div>
      ) : answer === null ? (
        <InlineSkeleton label="Loading purchases" />
      ) : (
        <>
          {stale && (
            <div className="ui-banner ui-banner--warn portfolio-warn" role="alert">
              <p>Could not refresh the purchases. The figures below may be out of date.</p>
              <button type="button" className="shell-button" onClick={() => reload(true)}>
                Try again
              </button>
            </div>
          )}
          {answer.lots.length === 0 ? (
            <p className="portfolio-none">No purchases to show.</p>
          ) : phone ? (
            <LotsList lots={answer.lots} basis={basis} currency={answer.currency} />
          ) : (
            <LotsTable lots={answer.lots} basis={basis} currency={answer.currency} />
          )}
          {!answer.complete && (
            <p className="ui-banner ui-banner--warn portfolio-warn" role="note">
              An account whose history starts later may hold more purchases than are listed.
            </p>
          )}
          {answer.lots.length > 0 && (
            <p className="shell-note portfolio-note">
              A purchase is ahead in real terms when it is worth more than what you paid grown by{' '}
              {answer.currency} inflation since that day.
              {answer.lots.some((lot) => readingOf(lot, basis) === null) &&
                ' A dash means a purchase price, a Bank of Russia rate or an inflation figure is missing for that purchase.'}
            </p>
          )}
        </>
      )}
    </section>
  );
}
