import { type FxRatesReport, fxRatesApi } from '@api/fx-rates.api';
import { announceClassificationChange } from '@api/operations.api';
import { ownerSettingsApi } from '@api/owner-settings.api';
import { type AccountingCurrency, accountingCurrencies } from '@api/portfolio-valuation.api';
import { useTheme } from '@contexts/ThemeContext';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import DataExport from '../export/DataExport';
import { money, rateText } from '../portfolio/format';
import SecuritySettings from '../security/SecuritySettings';
import { useMainCurrency } from './main-currency';
import { olderScreens } from './navigation';
import PageHeader from './PageHeader';
import '../portfolio/portfolio.css';
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

const dustAmount = /^[0-9]{1,7}(\.[0-9]{1,8})?$/;

/** The dust threshold as typed: empty turns it off; else a positive USD amount up to 1,000,000. */
function parseDust(text: string): string | null | undefined {
  const value = text.trim();
  if (value === '') return null;
  if (!dustAmount.test(value) || Number(value) <= 0 || Number(value) > 1_000_000) return undefined;
  return value;
}

/** CLS-DUST: incoming wallet transactions worth less than this skip "Needs classification". */
function DustThreshold() {
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  const [text, setText] = useState('');
  const [state, setState] = useState<
    'loading' | 'ready' | 'saving' | 'saved' | 'invalid' | 'failed' | 'save-failed'
  >('loading');
  useEffect(() => {
    let active = true;
    ownerSettingsApi
      .get()
      .then((settings) => {
        if (!active) return;
        setSaved(settings.dustThresholdUsd);
        setText(settings.dustThresholdUsd ?? '');
        setState('ready');
      })
      .catch(() => active && setState('failed'));
    return () => {
      active = false;
    };
  }, []);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const value = parseDust(text);
    if (value === undefined) {
      setState('invalid');
      return;
    }
    setState('saving');
    try {
      const settings = await ownerSettingsApi.update({ dustThresholdUsd: value });
      setSaved(settings.dustThresholdUsd);
      setText(settings.dustThresholdUsd ?? '');
      setState('saved');
      // The sidebar count and the dashboard re-read what needs classification.
      announceClassificationChange();
    } catch {
      setState('save-failed');
    }
  };
  const hint = {
    loading: 'Loading…',
    ready:
      saved === null
        ? 'Off: every incoming wallet transaction asks to be classified.'
        : `Incoming wallet transactions worth less than ${money(saved ?? null, 'USD')} at the latest price don't ask to be classified.`,
    saving: 'Saving…',
    saved:
      saved === null
        ? 'Saved. Every incoming wallet transaction asks to be classified again.'
        : `Saved. Smaller incoming transactions are under Transactions → Dust.`,
    invalid:
      'Enter an amount in USD above 0 and up to 1,000,000, or leave it empty to turn it off.',
    failed: 'Could not load the dust threshold; try again later.',
    'save-failed': 'Could not save the dust threshold; nothing changed.',
  }[state];
  const alert = state === 'invalid' || state === 'failed' || state === 'save-failed';
  return (
    <form className="shell-setting" onSubmit={(event) => void save(event)} noValidate>
      <div className="shell-setting__text">
        <label htmlFor="settings-dust" className="shell-setting__label">
          Dust threshold
        </label>
        <p
          id="settings-dust-hint"
          className="shell-setting__hint"
          role={alert ? 'alert' : undefined}
        >
          {hint}
        </p>
        <p className="shell-setting__hint">
          They still count in your balances, so wallets stay in step with the blockchain.
        </p>
      </div>
      <div className="shell-dust">
        <span className="shell-dust__unit" aria-hidden="true">
          $
        </span>
        <input
          id="settings-dust"
          type="text"
          inputMode="decimal"
          placeholder="Off"
          autoComplete="off"
          value={text}
          disabled={saved === undefined || state === 'saving'}
          aria-invalid={state === 'invalid' || undefined}
          aria-describedby="settings-dust-hint"
          onChange={(event) => {
            setText(event.target.value);
            if (state !== 'saving') setState('ready');
          }}
        />
        <button
          type="submit"
          className="shell-button shell-button--secondary"
          disabled={saved === undefined || state === 'saving' || text.trim() === (saved ?? '')}
        >
          Save
        </button>
      </div>
    </form>
  );
}

export default function SettingsPage() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div className="shell-page">
      <PageHeader title="Settings" />
      <div className="shell-settings">
        <SecuritySettings />
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
        <section className="shell-card" aria-labelledby="settings-wallets">
          <h2 id="settings-wallets">Wallets</h2>
          <DustThreshold />
        </section>
        <section className="shell-card" aria-labelledby="settings-history">
          <h2 id="settings-history">History</h2>
          <div className="shell-setting">
            <div className="shell-setting__text">
              <span className="shell-setting__label">Change history</span>
              <p className="shell-setting__hint">
                Who changed what and when: every transaction you added, corrected or deleted, and
                each answer to a blockchain transaction.
              </p>
            </div>
            <Link className="shell-button shell-button--secondary" to="/history">
              Open history
            </Link>
          </div>
        </section>
        <DataExport />
        <section className="shell-card" aria-labelledby="settings-older">
          <h2 id="settings-older">Older screens</h2>
          <p className="shell-note">
            These screens have not moved into the new layout yet. They are still in Russian and keep
            working as before.
          </p>
          {olderScreens.map(({ path, label, hint }) => (
            <div className="shell-setting" key={path}>
              <div className="shell-setting__text">
                <span className="shell-setting__label">{label}</span>
                <p className="shell-setting__hint">{hint}</p>
              </div>
              <Link className="shell-button shell-button--secondary" to={path}>
                Open {label.toLowerCase()}
              </Link>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
