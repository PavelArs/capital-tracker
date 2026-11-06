import type { EntityManager } from 'typeorm';
import { readEffectiveChanges, readPersonalRate } from '../inflation/inflation.service';
import {
  buildSeries,
  previousMonth,
  trailingYearEstimated,
  trailingYearPercent,
} from '../inflation/inflation-math';
import type { GoalCurrency } from './goal-input';
import type { YearlyInflation } from './goal-view';

/**
 * GOAL-REAL: the yearly inflation of a currency for each basis the owner can choose. Official is
 * the latest twelve months of the series the other pages use (the owner's typed-in months laid
 * over the published ones), with what it rests on beyond the published months so the screen does
 * not call an effective rate official; personal is the owner's own yearly rate. A basis with no
 * figure is null, so the goal shows no real reading for it instead of falling back to the other.
 */
export async function yearlyInflation(
  manager: EntityManager,
  owner: string,
  currency: GoalCurrency,
): Promise<YearlyInflation> {
  const { changes, manual } = await readEffectiveChanges(manager, owner, currency);
  const personal = await readPersonalRate(manager, owner, currency);
  const series = buildSeries(changes);
  const official = trailingYearPercent(series);
  // The twelve months the figure takes in: the latest one and the eleven before it.
  const window = new Set<string>();
  for (let month = series.last; month !== null && window.size < 12; month = previousMonth(month))
    window.add(month);
  return {
    official,
    personal: personal === null ? null : Number(personal),
    officialFrom: {
      ownMonths: manual.some((row) => window.has(row.month)),
      estimated: trailingYearEstimated(series) === true,
    },
  };
}
