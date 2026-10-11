import { type AccountingCurrency, accountingCurrencies } from '@api/portfolio-valuation.api';
import { type ReactNode, useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import { SegmentedPlaceholder } from '@/ui/SegmentedControl';
import AddTransactionDialog from '../portfolio/AddTransactionDialog';
import { CurrencySwitch, useAskedCurrency } from '../portfolio/currency';
import { useAttention } from './attention-context';
import { BellSlotContext } from './bell-slot';
import { Icon } from './icons';
import { useMainCurrency } from './main-currency';
import NotificationsBell from './NotificationsBell';
import './shell-page.css';
import { useCompactScreen } from '@/ui/useMediaQuery';

/**
 * The prototype's top bar on every page: title, display currency and "Add transaction".
 * The currency lives in the address (?currency=EUR), like the Portfolio switch; none
 * means the main currency. `currency` is what the page's data came back in, used until
 * the shell knows the main currency.
 */
export default function PageHeader({
  title,
  currency,
  actions,
  onTransactionSaved,
}: {
  title: ReactNode;
  currency?: AccountingCurrency;
  actions?: ReactNode;
  onTransactionSaved?: () => void;
}) {
  const [asked, setAsked] = useAskedCurrency();
  const { main } = useMainCurrency();
  const attention = useAttention();
  const [recording, setRecording] = useState(false);
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
      <button
        type="button"
        className="shell-button shell-button--primary"
        onClick={() => setRecording(true)}
      >
        <Icon name="plus" className="shell-icon shell-icon--sm" />
        Add transaction
      </button>
      {recording && (
        <AddTransactionDialog
          onClose={() => setRecording(false)}
          onSaved={() => {
            setRecording(false);
            attention?.refresh();
            onTransactionSaved?.();
          }}
        />
      )}
    </header>
  );
}
