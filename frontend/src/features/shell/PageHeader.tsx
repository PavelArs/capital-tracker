import { type AccountingCurrency, accountingCurrencies } from '@api/portfolio-valuation.api';
import { type ReactNode, useContext } from 'react';
import { createPortal } from 'react-dom';
import { SegmentedControl, SegmentedPlaceholder } from '@/ui/SegmentedControl';
import { CurrencySwitch, useAskedCurrency } from '../portfolio/currency';
import { BellSlotContext } from './bell-slot';
import { useMainCurrency } from './main-currency';
import NotificationsBell from './NotificationsBell';
import { useValueView, type ValueView } from './value-view';
import './shell-page.css';
import { useCompactScreen } from '@/ui/useMediaQuery';

/**
 * The prototype's top bar on every page: title, display currency and the bell. A page's main
 * action (Add wallet, Add transaction) sits below it, in the page's intro line.
 * The currency lives in the address (?currency=EUR), like the Portfolio switch; none
 * means the main currency. `currency` is what the page's data came back in, used until
 * the shell knows the main currency. Pages that show values after inflation add the
 * Nominal / Real switch, one choice for all of them, remembered in this browser.
 * A page that shows no money (Settings, History) passes `currencySwitch={false}` and has neither
 * switch.
 */
export default function PageHeader({
  title,
  currency,
  actions,
  valueSwitch = false,
  currencySwitch = true,
}: {
  title: ReactNode;
  currency?: AccountingCurrency;
  actions?: ReactNode;
  /** The page shows values after inflation: Nominal / Real sits beside the currency. */
  valueSwitch?: boolean;
  /** False on a page without amounts: no currency switch, and no Nominal / Real either. */
  currencySwitch?: boolean;
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
      {/* The menu puts the keyboard here after a section is chosen (Layout). */}
      <h1 tabIndex={-1}>{title}</h1>
      {actions ? <div className="shell-page__actions">{actions}</div> : null}
      {currencySwitch &&
        (shown ? (
          <CurrencySwitch value={shown} onChange={setAsked} />
        ) : (
          // The switch's room is held until the main currency is known, so the buttons do not step aside.
          <SegmentedPlaceholder labels={accountingCurrencies} />
        ))}
      {currencySwitch && valueSwitch && <ValueViewSwitch />}
      {!compact && bell}
      {compact && slot && createPortal(bell, slot)}
    </header>
  );
}

const valueViews: readonly (readonly [ValueView, string])[] = [
  ['nominal', 'Nominal'],
  ['real', 'Real'],
];

function ValueViewSwitch() {
  const [view, setView] = useValueView();
  return (
    <SegmentedControl
      name="value-view"
      label="Values"
      options={valueViews}
      value={view}
      onChange={setView}
    />
  );
}
