import type { EntityManager } from 'typeorm';
import { readEffectiveChanges, readPersonalRate } from '../inflation/inflation.service';
import { buildSeries, trailingYearPercent } from '../inflation/inflation-math';
import type { GoalCurrency } from './goal-input';
import type { YearlyInflation } from './goal-view';

/**
 * GOAL-REAL: the yearly inflation of a currency for each basis the owner can choose. Official is
 * the latest twelve months of the series the other pages use (the owner's typed-in months laid
 * over the published ones); personal is the owner's own yearly rate. A basis with no figure is
 * null, so the goal shows no real reading for it instead of falling back to the other basis.
 */
export async function yearlyInflation(
  manager: EntityManager,
  owner: string,
  currency: GoalCurrency,
): Promise<YearlyInflation> {
  const { changes } = await readEffectiveChanges(manager, owner, currency);
  const personal = await readPersonalRate(manager, owner, currency);
  return {
    official: trailingYearPercent(buildSeries(changes)),
    personal: personal === null ? null : Number(personal),
  };
}
