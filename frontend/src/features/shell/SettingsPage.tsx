import { cachedReads } from '@api/cached-reads';
import type { FxRatesReport } from '@api/fx-rates.api';
import { announceClassificationChange } from '@api/operations.api';
import { ownerSettingsApi } from '@api/owner-settings.api';
import { type AccountingCurrency, accountingCurrencies } from '@api/portfolio-valuation.api';
import { useAuth } from '@contexts/AuthContext';
import { useTheme } from '@contexts/ThemeContext';
import { useToast } from '@contexts/ToastContext';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Button, ButtonLink } from '@/ui/Button';
import { Card, CardHeader } from '@/ui/Card';
import { Affix, Input } from '@/ui/inputs';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { SettingRow } from '@/ui/SettingRow';
import { dayText } from '@/utils/dates';
import DataExport from '../export/DataExport';
import { money, rateText } from '../portfolio/format';
import HiddenAssets from '../portfolio/HiddenAssets';
import SecuritySettings from '../security/SecuritySettings';
import InflationSettings from './InflationSettings';
import { useMainCurrency } from './main-currency';
import PageHeader from './PageHeader';
import { Bone } from './Skeleton';
import './shell-page.css';

const themeChoices = [
  ['system', 'System'],
  ['dark', 'Dark'],
  ['light', 'Light'],
] as const;

/** The room a hint takes once it arrives, held empty so the cards below do not move. */
function PendingHint({ id }: { id?: string }) {
  return (
    <span id={id} className="ui-sub" aria-busy="true">
      <Bone width="70%" height={12} />
    </span>
  );
}

function ratesHint(report: FxRatesReport | 'failed'): string {
  if (report === 'failed') return 'Could not load the Bank of Russia rates.';
  const known = report.rates.flatMap((rate) =>
    rate.rubPerUnit && rate.date
      ? [`${rateText(rate.currency, rate.rubPerUnit)} (${dayText(rate.date)})`]
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
  // Coming back shows the settings last read while they are read again.
  const [saved, setSaved] = useState<AccountingCurrency | null>(
    () => cachedReads.settings.last()?.mainCurrency ?? null,
  );
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'failed' | 'save-failed'>(
    () => (cachedReads.settings.last() ? 'ready' : 'loading'),
  );
  const [rates, setRates] = useState<FxRatesReport | null | 'failed'>(
    () => cachedReads.rates.last() ?? null,
  );
  const { setMain } = useMainCurrency();
  const toast = useToast();
  const latest = useRef(0);
  useEffect(() => {
    let active = true;
    cachedReads.settings
      .load()
      .then((settings) => {
        if (!active) return;
        setSaved(settings.mainCurrency);
        setState('ready');
      })
      .catch(() => active && setState((current) => (current === 'ready' ? current : 'failed')));
    cachedReads.rates
      .load()
      .then((report) => active && setRates(report))
      .catch(() => active && setRates((current) => current ?? 'failed'));
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
      toast.show({
        tone: 'error',
        title: 'Could not save the main currency',
        detail: 'Nothing changed.',
      });
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
  const failedState = state === 'failed' || state === 'save-failed';
  return (
    <SettingRow
      title="Main currency"
      titleId="settings-currency"
      description={
        <>
          <span id="settings-currency-hint" role={failedState ? 'alert' : undefined}>
            {hint}
          </span>
          {rates === null ? <PendingHint /> : <span className="ui-sub">{ratesHint(rates)}</span>}
        </>
      }
      control={
        <SegmentedControl
          name="main-currency"
          labelledBy="settings-currency"
          describedBy="settings-currency-hint"
          options={accountingCurrencies}
          value={saved}
          disabled={saved === null}
          onChange={(currency) => void choose(currency)}
        />
      }
    />
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
  const toast = useToast();
  const kept = cachedReads.settings.last();
  const [saved, setSaved] = useState<string | null | undefined>(kept?.dustThresholdUsd);
  const [text, setText] = useState(kept?.dustThresholdUsd ?? '');
  const [state, setState] = useState<
    'loading' | 'ready' | 'saving' | 'saved' | 'invalid' | 'failed' | 'save-failed'
  >(kept ? 'ready' : 'loading');
  useEffect(() => {
    let active = true;
    cachedReads.settings
      .load()
      .then((settings) => {
        if (!active) return;
        setSaved(settings.dustThresholdUsd);
        setText(settings.dustThresholdUsd ?? '');
        setState('ready');
      })
      .catch(() => active && setState((current) => (current === 'ready' ? current : 'failed')));
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
      toast.show({ tone: 'success', title: 'Dust threshold saved' });
      // The sidebar count and the dashboard re-read what needs classification.
      announceClassificationChange();
    } catch {
      setState('save-failed');
      toast.show({
        tone: 'error',
        title: 'Could not save the dust threshold',
        detail: 'Nothing changed.',
      });
    }
  };
  const hint = {
    loading: '',
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
  const disabled = saved === undefined || state === 'saving';
  return (
    <form onSubmit={(event) => void save(event)} noValidate>
      <SettingRow
        title={<label htmlFor="settings-dust">Dust threshold</label>}
        description={
          <>
            {state === 'loading' ? (
              <PendingHint id="settings-dust-hint" />
            ) : (
              <span id="settings-dust-hint" role={alert ? 'alert' : undefined}>
                {hint}
              </span>
            )}
            <span className="ui-sub">
              They still count in your balances, so wallets stay in step with the blockchain.
            </span>
          </>
        }
        control={
          <>
            <div style={{ width: '9.5rem' }}>
              <Affix suffix="USD">
                <Input
                  id="settings-dust"
                  numeric
                  type="text"
                  placeholder="Off"
                  autoComplete="off"
                  value={text}
                  disabled={disabled}
                  aria-invalid={state === 'invalid' || undefined}
                  aria-describedby="settings-dust-hint"
                  onChange={(event) => {
                    setText(event.target.value);
                    if (state !== 'saving') setState('ready');
                  }}
                />
              </Affix>
            </div>
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled={disabled || text.trim() === (saved ?? '')}
            >
              Save
            </Button>
          </>
        }
      />
    </form>
  );
}

/** Prototype Settings → Profile: the address the owner signs in with. */
function Profile() {
  const { user } = useAuth();
  return (
    <Card labelledBy="settings-profile">
      <CardHeader id="settings-profile" title="Profile" />
      <SettingRow
        title="Email"
        description="Used to sign in and for password reset links."
        control={<span className="ui-strong">{user?.email ?? '—'}</span>}
      />
    </Card>
  );
}

export default function SettingsPage() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div className="shell-page">
      <PageHeader title="Settings" currencySwitch={false} />
      <div className="settings-stack">
        <Profile />
        <SecuritySettings />
        <Card labelledBy="settings-display">
          <CardHeader id="settings-display" title="Display" />
          <MainCurrency />
          <SettingRow
            title="Theme"
            titleId="settings-theme"
            description={
              <span id="settings-theme-hint">
                {theme === 'system'
                  ? `Follows your device, now ${resolvedTheme}`
                  : 'Saved in this browser'}
              </span>
            }
            control={
              <SegmentedControl
                name="theme"
                labelledBy="settings-theme"
                describedBy="settings-theme-hint"
                options={themeChoices}
                value={theme}
                onChange={setTheme}
              />
            }
          />
        </Card>
        <InflationSettings />
        <Card labelledBy="settings-wallets">
          <CardHeader id="settings-wallets" title="Wallets" />
          <DustThreshold />
        </Card>
        <HiddenAssets />
        <Card labelledBy="settings-history">
          <CardHeader id="settings-history" title="History" />
          <SettingRow
            title="Change history"
            description="Who changed what and when: every transaction you added, corrected or deleted, and each answer to a blockchain transaction."
            control={
              <ButtonLink variant="secondary" size="sm" to="/history">
                Open history
              </ButtonLink>
            }
          />
        </Card>
        <DataExport />
      </div>
    </div>
  );
}
