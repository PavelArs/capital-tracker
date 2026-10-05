import { type FxRatesReport, fxRatesApi } from '@api/fx-rates.api';
import { ownerSettingsApi } from '@api/owner-settings.api';
import { type AccountingCurrency, accountingCurrencies } from '@api/portfolio-valuation.api';
import { useTheme } from '@contexts/ThemeContext';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { rateText } from '../portfolio/format';
import { useMainCurrency } from './main-currency';
import PageHeader from './PageHeader';
import './shell-page.css';

const themeChoices = [
  ['system', 'System'],
  ['dark', 'Dark'],
  ['light', 'Light'],
] as const;

const rateDate = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

function ratesHint(report: FxRatesReport | null | 'failed'): string {
  if (report === null) return 'Loading Bank of Russia rates…';
  if (report === 'failed') return 'Could not load the Bank of Russia rates.';
  const known = report.rates.flatMap((rate) =>
    rate.rubPerUnit && rate.date
      ? [`${rateText(rate.currency, rate.rubPerUnit)} (${rateDate.format(new Date(rate.date))})`]
      : [],
  );
  const text = known.length
    ? `Bank of Russia: ${known.join(', ')}.`
    : 'No Bank of Russia rate is stored yet; EUR and RUB show "No rate".';
  return report.sync?.errorMessage
    ? `${text} Last update failed: ${report.sync.errorMessage}.`
    : text;
}

/** Main currency of every screen; stored for the owner, so it survives logout (CUR-SWITCH). */
function MainCurrency() {
  const [saved, setSaved] = useState<AccountingCurrency | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'failed' | 'save-failed'>(
    'loading',
  );
  const [rates, setRates] = useState<FxRatesReport | null | 'failed'>(null);
  const { setMain } = useMainCurrency();
  const latest = useRef(0);
  useEffect(() => {
    let active = true;
    ownerSettingsApi
      .get()
      .then((settings) => {
        if (!active) return;
        setSaved(settings.mainCurrency);
        setState('ready');
      })
      .catch(() => active && setState('failed'));
    fxRatesApi
      .get()
      .then((report) => active && setRates(report))
      .catch(() => active && setRates('failed'));
    return () => {
      active = false;
    };
  }, []);
  const choose = async (currency: AccountingCurrency) => {
    const request = ++latest.current;
    const previous = saved;
    setSaved(currency);
    setState('saving');
    try {
      const settings = await ownerSettingsApi.update({ mainCurrency: currency });
      if (request !== latest.current) return;
      setSaved(settings.mainCurrency);
      setMain(settings.mainCurrency);
      setState('ready');
    } catch {
      if (request !== latest.current) return;
      setSaved(previous);
      setState('save-failed');
    }
  };
  const hint =
    state === 'failed'
      ? 'Could not load your main currency; try again later.'
      : state === 'save-failed'
        ? 'Could not save the main currency; nothing changed.'
        : state === 'saving'
          ? 'Saving…'
          : 'Portfolio values, cost and P&L are shown in it; the other two stay one click away.';
  return (
    <div className="shell-setting">
      <div className="shell-setting__text">
        <span id="settings-currency" className="shell-setting__label">
          Main currency
        </span>
        <p
          id="settings-currency-hint"
          className="shell-setting__hint"
          role={state === 'failed' || state === 'save-failed' ? 'alert' : undefined}
        >
          {hint}
        </p>
        <p className="shell-setting__hint">{ratesHint(rates)}</p>
      </div>
      <div
        className="shell-seg"
        role="radiogroup"
        aria-labelledby="settings-currency"
        aria-describedby="settings-currency-hint"
      >
        {accountingCurrencies.map((currency) => (
          <label key={currency}>
            <input
              type="radio"
              name="main-currency"
              value={currency}
              checked={saved === currency}
              disabled={saved === null}
              onChange={() => void choose(currency)}
            />
            {currency}
          </label>
        ))}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div className="shell-page">
      <PageHeader title="Settings" />
      <div className="shell-settings">
        <section className="shell-card" aria-labelledby="settings-display">
          <h2 id="settings-display">Display</h2>
          <div className="shell-setting">
            <div className="shell-setting__text">
              <span id="settings-theme" className="shell-setting__label">
                Theme
              </span>
              <p id="settings-theme-hint" className="shell-setting__hint">
                {theme === 'system'
                  ? `Follows your device, now ${resolvedTheme}`
                  : 'Saved in this browser'}
              </p>
            </div>
            <div
              className="shell-seg"
              role="radiogroup"
              aria-labelledby="settings-theme"
              aria-describedby="settings-theme-hint"
            >
              {themeChoices.map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="theme"
                    value={value}
                    checked={theme === value}
                    onChange={() => setTheme(value)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <MainCurrency />
        </section>
        <p className="shell-note">
          Security, sessions and export arrive in later steps. Language and the old display rates
          are still in <Link to="/settings">Legacy settings</Link>.
        </p>
      </div>
    </div>
  );
}
