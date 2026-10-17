import { type AccountingCurrency, accountingCurrencies } from '@api/portfolio-valuation.api';
import type { ReactNode } from 'react';
import { SegmentedControl, SegmentedPlaceholder } from '@/ui/SegmentedControl';
import { CurrencySwitch, useAskedCurrency } from '../portfolio/currency';
import { BrandMark } from './icons';
import { useMainCurrency } from './main-currency';
import NotificationsBell from './NotificationsBell';
import { useValueView, type ValueView } from './value-view';
import './shell-page.css';

/**
 * The prototype's top bar on every page: title, display currency and the bell. A page's main
 * action (Add wallet, Add transaction) sits below it, in the page's intro line.
 * The currency lives in the address (?currency=EUR), like the Portfolio switch; none
 * means the main currency. `currency` is what the page's data came back in, used until
 * the shell knows the main currency. Pages that show values after inflation add the
 * Nominal / Real switch, one choice for all of them, remembered in this browser.
 * A page that shows no money (Settings, History) passes `currencySwitch={false}` and has neither
 * switch. Below 861 px the title row (mark, title, bell) is the phone's sticky title bar and the
 * switches sit in a row under it that scrolls away (polish §3).
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
  const shown = asked ?? currency ?? main;
  return (
    <header className="shell-page__head">
      <div className="shell-page__bar">
        <BrandMark className="shell-page__mark" />
        {/* The menu puts the keyboard here after a section is chosen (Layout). */}
        <h1 tabIndex={-1}>{title}</h1>
        <div className="shell-page__bell">
          <NotificationsBell asked={asked} />
        </div>
      </div>
      {actions ? <div className="shell-page__actions">{actions}</div> : null}
      {currencySwitch && (
        <div className="shell-page__switches">
          {shown ? (
            <CurrencySwitch value={shown} onChange={setAsked} />
          ) : (
            // The switch's room is held until the main currency is known, so the buttons do not step aside.
            <SegmentedPlaceholder labels={accountingCurrencies} />
          )}
          {valueSwitch && <ValueViewSwitch />}
        </div>
      )}
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
