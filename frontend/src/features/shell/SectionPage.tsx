import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import type { ReactNode } from 'react';
import PageIntro from '@/ui/PageIntro';
import { Icon } from './icons';
import PageHeader from './PageHeader';
import './section-page.css';
import './shell-page.css';

/** The page's main action ("Add property"): always the primary button, always in the intro line. */
export function SectionAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="shell-button shell-button--primary" onClick={onClick}>
      <Icon name="plus" className="shell-icon shell-icon--sm" />
      {children}
    </button>
  );
}

/**
 * The cards of a section, one list item each. `cards` fills the width with as many columns as
 * fit; `wide` puts one full-width card on each line, for cards that hold rows of their own.
 */
export function SectionGrid({
  variant = 'cards',
  children,
}: {
  variant?: 'cards' | 'wide';
  children: ReactNode;
}) {
  return <ul className={`section-grid section-grid--${variant}`}>{children}</ul>;
}

/**
 * The frame of a section page (Goals, Real estate, Brokers), the same on each so the title, the
 * main action and the totals sit where the owner expects them: the top bar with the title and
 * the currency; the intro line, what the page holds with the main action beside it; a notice;
 * the totals card; the cards (or the empty card, or the skeleton); a footnote.
 */
export default function SectionPage({
  title,
  currency,
  intro,
  action,
  notice,
  summary,
  footnote,
  children,
}: {
  title: ReactNode;
  currency?: AccountingCurrency;
  /** What the page holds, in one or two sentences. */
  intro: ReactNode;
  /** The main action, a `SectionAction`. */
  action: ReactNode;
  /** A line about what was just done, or a warning about the figures below. */
  notice?: ReactNode;
  /** The totals card (`SummaryCard`). */
  summary?: ReactNode;
  footnote?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="shell-page">
      <PageHeader title={title} currency={currency} />
      <PageIntro action={action}>{intro}</PageIntro>
      {notice}
      {summary}
      {children}
      {footnote}
    </div>
  );
}
