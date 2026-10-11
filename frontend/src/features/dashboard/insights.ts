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

// The ticker, or "TICKER · name" and then the end of the id when assets share a ticker, so two
// cards never read the same for different assets.
function assetLabels(portfolio: PortfolioValuation): Map<string, string> {
  const base = (asset: PortfolioValuation['assets'][number]) => asset.symbol ?? asset.name;
  const count = (texts: string[]) =>
    texts.reduce((all, text) => all.set(text, (all.get(text) ?? 0) + 1), new Map<string, number>());
  const first = count(portfolio.assets.map(base));
  const named = portfolio.assets.map((asset) => ({
    asset,
    text: (first.get(base(asset)) ?? 0) > 1 ? `${base(asset)} · ${asset.name}` : base(asset),
  }));
  const second = count(named.map(({ text }) => text));
  return new Map(
    named.map(({ asset, text }) => [
      asset.instrumentId,
      (second.get(text) ?? 0) > 1 ? `${text} · #${asset.instrumentId.slice(-6)}` : text,
    ]),
  );
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
  const labels = assetLabels(portfolio);
  const label = (instrumentId: string) => labels.get(instrumentId) ?? 'An asset';

  // Every rule that could not be checked says why, so one gap never hides another.
  const notes: string[] = [];
  let unchecked = 0;
  const drift: { gap: number; item: InsightItem }[] = [];
  if (rules.targets.length > 0) {
    if (!portfolio.allocation.complete || portfolio.totalValue === null) {
      // Only what is held counts: an instrument at zero quantity never blocks the allocation.
      const held = portfolio.assets.filter((asset) => Number(asset.quantity) !== 0);
      const noRate = held.some((asset) => asset.missingPrice === 'no-rate');
      const noPrice = held.some((asset) => asset.missingPrice === 'no-price');
      const history = portfolio.unavailableAccountCount > 0;
      const reasons = [
        (noPrice || (!noRate && !history)) && 'some holdings have no price yet',
        noRate && 'some values have no exchange rate yet',
        history && "an account's history starts later",
      ].filter((reason): reason is string => reason !== false);
      const reason = reasons.join(' and ').replace(/^./, (letter) => letter.toUpperCase());
      notes.push(`${reason}, so shares are not compared.`);
    } else if (Number(portfolio.totalValue) <= 0) {
      notes.push('The portfolio has no value yet, so shares are not compared.');
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
        // Hundredths of a point as whole numbers, so a limit such as 0.06 is not missed by
        // binary rounding (0.01 - 0.07 is not exactly -0.06).
        const actual = Number(held.allocationPercent ?? 0);
        const target = Number(percent);
        const gapHundredths = Math.round(actual * 100) - Math.round(target * 100);
        if (Math.abs(gapHundredths) <= Math.round(Number(rules.driftPoints) * 100)) continue;
        const gap = gapHundredths / 100;
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

  if (unchecked > 0) {
    notes.push(
      unchecked === 1
        ? '1 target is not checked: its asset is hidden or no longer held.'
        : `${unchecked} targets are not checked: their assets are hidden or no longer held.`,
    );
  }

  let unpriced = 0;
  let unrated = 0;
  let zeroCost = 0;
  const review: { size: number; item: InsightItem }[] = [];
  const levels = rules.gainReviewPercent !== null || rules.lossReviewPercent !== null;
  // With an account whose history starts later, every return covers only part of the portfolio.
  const partial = portfolio.unavailableAccountCount > 0;
  if (levels && partial) {
    notes.push("An account's history starts later, so returns on cost are not checked.");
  }
  for (const asset of levels && !partial ? portfolio.assets : []) {
    if (Number(asset.knownCostQuantity) <= 0) continue;
    // Known cost but no current price or rate: the return cannot be checked yet.
    if (asset.knownUnrealizedReturnPercent === null) {
      const checkable = Number(asset.quantity) !== 0;
      if (checkable && asset.missingPrice === 'no-rate') unrated += 1;
      else if (checkable && asset.missingPrice === 'no-price') unpriced += 1;
      // Priced, but a cost of zero leaves no percentage to compare.
      else if (checkable) zeroCost += 1;
      continue;
    }
    const change = Number(asset.knownUnrealizedReturnPercent);
    const gain = rules.gainReviewPercent;
    const loss = rules.lossReviewPercent;
    const name = label(asset.instrumentId);
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

  const notChecked = unpriced + unrated;
  if (notChecked > 0) {
    const missing =
      unrated === 0 ? 'price' : unpriced === 0 ? 'exchange rate' : 'price or exchange rate';
    notes.push(
      notChecked === 1
        ? `1 asset has no ${missing} yet, so its return on cost is not checked.`
        : `${notChecked} assets have no ${missing} yet, so their returns on cost are not checked.`,
    );
  }

  if (zeroCost > 0) {
    notes.push(
      zeroCost === 1
        ? '1 asset has a cost of zero, so its return is not compared.'
        : `${zeroCost} assets have a cost of zero, so their returns are not compared.`,
    );
  }

  const widest = (a: { gap?: number; size?: number }, b: { gap?: number; size?: number }) =>
    (b.gap ?? b.size ?? 0) - (a.gap ?? a.size ?? 0);
  return {
    items: [...drift.sort(widest), ...review.sort(widest)].map(({ item }) => item),
    note: notes.length > 0 ? notes.join(' ') : null,
  };
}
