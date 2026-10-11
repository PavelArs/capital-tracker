import { type AccountingCurrency, accountingCurrencies } from '@api/portfolio-valuation.api';
import { type ReactNode, useContext } from 'react';
import { createPortal } from 'react-dom';
import { SegmentedPlaceholder } from '@/ui/SegmentedControl';
import { CurrencySwitch, useAskedCurrency } from '../portfolio/currency';
import { BellSlotContext } from './bell-slot';
import { useMainCurrency } from './main-currency';
import NotificationsBell from './NotificationsBell';
import './shell-page.css';
import { useCompactScreen } from '@/ui/useMediaQuery';

/**
 * The prototype's top bar on every page: title, display currency and the bell. A page's main
 * action (Add wallet, Add transaction) sits below it, in the page's intro line.
 * The currency lives in the address (?currency=EUR), like the Portfolio switch; none
 * means the main currency. `currency` is what the page's data came back in, used until
 * the shell knows the main currency.
 */
export default function PageHeader({
  title,
  currency,
  actions,
}: {
  title: ReactNode;
  currency?: AccountingCurrency;
  actions?: ReactNode;
}) {
  const [asked, setAsked] = useAskedCurrency();
  const { main } = useMainCurrency();
  // On a phone the bell sits in the top bar next to the owner (Layout), not in this row.
  const compact = useCompactScreen();
  const slot = useContext(BellSlotContext);
  const bell = <NotificationsBell asked={asked} />;
  const shown = asked ?? currency ?? main;
  return (
    <header className="shell-page__head">
      <h1>{title}</h1>
      {actions ? <div className="shell-page__actions">{actions}</div> : null}
      {shown ? (
        <CurrencySwitch value={shown} onChange={setAsked} />
      ) : (
        // The switch's room is held until the main currency is known, so the buttons do not step aside.
        <SegmentedPlaceholder labels={accountingCurrencies} />
      )}
      {!compact && bell}
      {compact && slot && createPortal(bell, slot)}
    </header>
  );
}
