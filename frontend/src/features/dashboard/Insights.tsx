import type { AccountingCurrency, PortfolioValuation } from '@api/portfolio-valuation.api';
import { useId } from 'react';
import { Link } from 'react-router-dom';
import { withCurrency } from '../portfolio/currency';
import { useMainCurrency } from '../shell/main-currency';
import { collectInsights } from './insights';

/**
 * INS-CARD: what the owner's own insight rules found in today's portfolio. Without rules
 * there is no card; a failed read of the rules hides it rather than guessing.
 */
export default function Insights({
  portfolio,
  asked,
}: {
  portfolio: PortfolioValuation;
  asked: AccountingCurrency | undefined;
}) {
  const heading = useId();
  // The shell read the rules with the main currency; a failed read leaves no card.
  const { insightRules: rules } = useMainCurrency();
  if (!rules) return null;
  const { items, note } = collectInsights(portfolio, rules);
  return (
    <section className="shell-card dashboard-insights" aria-labelledby={heading}>
      <div className="portfolio-toolbar">
        <h2 id={heading}>Insights</h2>
        <Link className="dashboard-link" to="/preferences">
          Rules
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="portfolio-none">
          {note === null ? 'Everything is within your rules.' : note}
        </p>
      ) : (
        <ul className="dashboard-insights__list">
          {items.map((item) => (
            <li key={item.key}>
              <Link to={withCurrency(`/portfolio/${item.instrumentId}`, asked)}>{item.title}</Link>
              <p>{item.detail}</p>
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 && note !== null && <p className="dashboard-insights__note">{note}</p>}
      <p className="dashboard-insights__note">
        Worked out from your own numbers and rules. It does not predict prices and is not financial
        advice.
      </p>
    </section>
  );
}
