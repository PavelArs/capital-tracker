import type { InsightRules } from '@api/owner-settings.api';
import type { PortfolioValuation } from '@api/portfolio-valuation.api';
import { money } from '../portfolio/format';

export interface InsightItem {
  key: string;
  title: string;
  detail: string;
  /** The asset it is about, for a link to its page. */
  instrumentId: string;
}

export interface Insights {
  items: InsightItem[];
  /** Why part of the rules could not be checked; null when everything could. */
  note: string | null;
}

const plain = (value: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);

// INS-DRIFT and INS-REVIEW: facts computed from the portfolio against the owner's own numbers.
// Nothing here predicts a price or says what to buy or sell; it points at what is worth a look.
export function collectInsights(
  portfolio: PortfolioValuation,
  rules: InsightRules | null,
): Insights {
  if (!rules) return { items: [], note: null };
  const label = (instrumentId: string) => {
    const asset = portfolio.assets.find((item) => item.instrumentId === instrumentId);
    return asset?.symbol ?? asset?.name ?? 'An asset';
  };

  let note: string | null = null;
  let unchecked = 0;
  const drift: { gap: number; item: InsightItem }[] = [];
  if (rules.targets.length > 0) {
    if (!portfolio.allocation.complete || portfolio.totalValue === null) {
      note = 'Some holdings have no price yet, so shares are not compared.';
    } else {
      const total = Number(portfolio.totalValue);
      for (const { instrumentId, percent } of rules.targets) {
        const held = portfolio.assets.find((asset) => asset.instrumentId === instrumentId);
        // A hidden or removed asset is no longer in the valuation: its target cannot be checked,
        // and the card must not claim everything is within the rules.
        if (!held) {
          unchecked += 1;
          continue;
        }
        const actual = Number(held.allocationPercent ?? 0);
        const target = Number(percent);
        const gap = actual - target;
        if (Math.abs(gap) <= Number(rules.driftPoints)) continue;
        const over = gap > 0;
        const amount = money(String((Math.abs(gap) / 100) * total), portfolio.currency);
        drift.push({
          gap: Math.abs(gap),
          item: {
            key: `drift:${instrumentId}`,
            instrumentId,
            title: `${label(instrumentId)} is ${over ? 'above' : 'below'} its target`,
            detail: `${plain(actual)}% of your portfolio against a ${plain(target)}% target: ${plain(Math.abs(gap))} points ${over ? 'over' : 'under'}, about ${amount}.`,
          },
        });
      }
    }
  }

  if (unchecked > 0 && note === null) {
    note =
      unchecked === 1
        ? '1 target is not checked: its asset is hidden or no longer held.'
        : `${unchecked} targets are not checked: their assets are hidden or no longer held.`;
  }

  let unpriced = 0;
  const review: { size: number; item: InsightItem }[] = [];
  for (const asset of portfolio.assets) {
    if (Number(asset.knownCostQuantity) <= 0) continue;
    // Known cost but no current price or rate: the return cannot be checked yet.
    if (asset.knownUnrealizedReturnPercent === null) {
      if (
        Number(asset.quantity) !== 0 &&
        (rules.gainReviewPercent !== null || rules.lossReviewPercent !== null)
      )
        unpriced += 1;
      continue;
    }
    const change = Number(asset.knownUnrealizedReturnPercent);
    const gain = rules.gainReviewPercent;
    const loss = rules.lossReviewPercent;
    const name = asset.symbol ?? asset.name;
    if (gain !== null && change >= Number(gain)) {
      review.push({
        size: change,
        item: {
          key: `review:${asset.instrumentId}`,
          instrumentId: asset.instrumentId,
          title: `${name} is up ${plain(change)}% on its cost`,
          detail: `At or above your +${plain(Number(gain))}% review level.`,
        },
      });
    } else if (loss !== null && change <= -Number(loss)) {
      review.push({
        size: Math.abs(change),
        item: {
          key: `review:${asset.instrumentId}`,
          instrumentId: asset.instrumentId,
          title: `${name} is down ${plain(Math.abs(change))}% on its cost`,
          detail: `At or below your −${plain(Number(loss))}% review level.`,
        },
      });
    }
  }

  if (unpriced > 0 && note === null) {
    note =
      unpriced === 1
        ? '1 asset has no price yet, so its return on cost is not checked.'
        : `${unpriced} assets have no price yet, so their returns on cost are not checked.`;
  }

  const widest = (a: { gap?: number; size?: number }, b: { gap?: number; size?: number }) =>
    (b.gap ?? b.size ?? 0) - (a.gap ?? a.size ?? 0);
  return {
    items: [...drift.sort(widest), ...review.sort(widest)].map(({ item }) => item),
    note,
  };
}
