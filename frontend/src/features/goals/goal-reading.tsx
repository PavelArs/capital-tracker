import type { GoalCurrency, GoalPreview, GoalReal } from '@api/goals.api';
import { Link } from 'react-router-dom';
import { Banner } from '@/ui/Banner';
import { DASH } from '../portfolio/format';
import { type InflationBasis, useInflationBasis } from '../shell/inflation-basis';
import { useValueView } from '../shell/value-view';
import { verdict } from './goal-format';

// GOAL-REAL: a goal read in the mode the Nominal / Real switch holds. The server answers both
// readings; this picks one, so a page shows only that reading's figures, labels and notes.

export type GoalMode = { real: false } | { real: true; basis: InflationBasis };

/** The mode of the switch and, under Real, the inflation basis chosen in Settings. */
export function useGoalMode(): GoalMode {
  const [view] = useValueView();
  const [basis] = useInflationBasis();
  return view === 'real' ? { real: true, basis } : { real: false };
}

/** Why a basis has no real figure, written for the figure that is missing. */
export function noRealFigure(currency: GoalCurrency, basis: InflationBasis): string {
  return basis === 'official'
    ? `No real figure: there is no official inflation figure for ${currency} yet.`
    : `No real figure: no ${currency} inflation rate of your own is set in Settings.`;
}

export interface GoalReading<T extends GoalPreview> {
  /** The goal with the chosen reading's status, cases and expected return laid over it. */
  goal: T;
  mode: GoalMode;
  /** Under Real, the reading of the basis; null when it has no figure. Always null under Nominal. */
  real: GoalReal | null;
  /** Under Real with no figure: why. Null otherwise. */
  missing: string | null;
}

/**
 * The goal as the chosen mode reads it. Under Real with no reading for the basis the goal is
 * unknown with no cases, never the nominal figures in their place.
 */
export function readGoal<T extends GoalPreview>(goal: T, mode: GoalMode): GoalReading<T> {
  if (!mode.real) return { goal, mode, real: null, missing: null };
  const real = goal.real?.[mode.basis] ?? null;
  if (real === null)
    // Reaching the sum is exact progress, the same in both modes; only the plan needs a rate.
    return goal.status === 'reached'
      ? { goal: { ...goal, scenarios: [] }, mode, real: null, missing: null }
      : {
          goal: { ...goal, status: 'unknown', scenarios: [] },
          mode,
          real: null,
          missing: noRealFigure(goal.currency, mode.basis),
        };
  return {
    goal: {
      ...goal,
      status: real.status,
      scenarios: real.scenarios,
      expectedReturnPercent: real.returnPercent,
    },
    mode,
    real,
    missing: null,
  };
}

/** The sentence under a goal in the chosen mode. */
export const verdictOf = (reading: GoalReading<GoalPreview>): string =>
  reading.missing ?? verdict(reading.goal);

/** A percent in tenths, rounded toward minus infinity (or plus, with `up`), exactly. */
function tenths(percent: string, up: boolean): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(percent);
  if (!match) return DASH;
  const thousandths = BigInt(`${match[2]}${(match[3] ?? '').padEnd(4, '0').slice(0, 4)}`);
  const signed = match[1] ? -thousandths : thousandths;
  const unit = 1000n;
  const quotient = signed / unit;
  const floor = signed % unit !== 0n && signed < 0n ? quotient - 1n : quotient;
  const rounded = up && signed % unit !== 0n ? floor + 1n : floor;
  const negative = rounded < 0n;
  const magnitude = (negative ? -rounded : rounded).toString().padStart(2, '0');
  const whole = magnitude.slice(0, -1);
  const fraction = magnitude.slice(-1);
  return `${negative ? '-' : ''}${whole}${fraction === '0' ? '' : `.${fraction}`}`;
}

/** A real return to one decimal, rounded down: never a better figure than it is. */
export const realRateText = (percent: string): string => tenths(percent, false);

/** An inflation rate to one decimal, rounded up: never a smaller loss than it is. */
export const inflationText = (percent: string): string => tenths(percent, true);

/**
 * The note under Real that says what the figures rest on: the target keeps its value, the
 * returns count after the inflation of each currency, by the rate the owner chose.
 */
export function RealNote({
  goals,
  basis,
}: {
  goals: readonly GoalPreview[];
  basis: InflationBasis;
}) {
  const rates = new Map<GoalCurrency, GoalReal>();
  for (const goal of goals) {
    const real = goal.real?.[basis];
    if (real) rates.set(goal.currency, real);
  }
  // An effective rate is not an official one: say when typed-in or estimated months are in it.
  const derived = (real: GoalReal) => {
    const { ownMonths, estimated } = real.from;
    if (basis !== 'official' || !(ownMonths || estimated)) return '';
    const what = ownMonths
      ? `months you typed in${estimated ? ' and estimated ones' : ''}`
      : 'estimated months';
    return ` (official with ${what})`;
  };
  const pure = [...rates.values()].every((real) => derived(real) === '');
  const how =
    basis !== 'official' ? 'your own rate' : pure ? 'official, last 12 months' : 'last 12 months';
  const list = [...rates].map(
    ([currency, real]) => `${currency} ${inflationText(real.inflationPercent)}%${derived(real)}`,
  );
  return (
    <Banner tone="neutral" icon="info">
      {"In today's money. Targets keep their value, and returns count after inflation"}
      {list.length > 0 ? `: ${list.join(', ')} a year, ${how}. ` : '. '}
      <Link to="/settings">Settings</Link>
    </Banner>
  );
}
