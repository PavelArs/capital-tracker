import { cachedReads } from '@api/cached-reads';
import { type InsightRules, ownerSettingsApi } from '@api/owner-settings.api';
import type { AssetValuation } from '@api/portfolio-valuation.api';
import { type FormEvent, useEffect, useState } from 'react';
import { useMainCurrency } from './main-currency';

interface Row {
  key: number;
  instrumentId: string;
  percent: string;
}

type State = 'loading' | 'ready' | 'saving' | 'saved' | 'invalid' | 'failed' | 'save-failed';

const DEFAULT_DRIFT = '5';
const share = /^[0-9]{1,5}(\.[0-9]{1,2})?$/;

const inRange = (text: string, min: number, max: number) =>
  share.test(text) && Number(text) >= min && Number(text) <= max;

/** The rules as typed; undefined where something is not valid, null where nothing is set. */
function parseForm(
  rows: Row[],
  drift: string,
  gain: string,
  loss: string,
): InsightRules | null | undefined {
  const targets = rows.map((row) => ({
    instrumentId: row.instrumentId,
    percent: row.percent.trim(),
  }));
  const gainText = gain.trim();
  const lossText = loss.trim();
  if (targets.length === 0 && gainText === '' && lossText === '') return null;
  if (targets.some((row) => row.instrumentId === '' || !inRange(row.percent, 0.01, 100)))
    return undefined;
  if (new Set(targets.map((row) => row.instrumentId)).size !== targets.length) return undefined;
  if (targets.reduce((sum, row) => sum + Math.round(Number(row.percent) * 100), 0) > 10_000)
    return undefined;
  if (!inRange(drift.trim(), 0.01, 50)) return undefined;
  if (gainText !== '' && !inRange(gainText, 0.01, 10_000)) return undefined;
  if (lossText !== '' && !inRange(lossText, 0.01, 99.99)) return undefined;
  return {
    targets,
    driftPoints: drift.trim(),
    gainReviewPercent: gainText === '' ? null : gainText,
    lossReviewPercent: lossText === '' ? null : lossText,
  };
}

// "BTC · Bitcoin"; where two assets still read the same, the accounts holding them tell them apart.
function optionLabels(assets: AssetValuation[]): Map<string, string> {
  const base = (asset: AssetValuation) =>
    asset.symbol && asset.symbol !== asset.name ? `${asset.symbol} · ${asset.name}` : asset.name;
  const counts = new Map<string, number>();
  for (const asset of assets) counts.set(base(asset), (counts.get(base(asset)) ?? 0) + 1);
  return new Map(
    assets.map((asset) => {
      const text = base(asset);
      const accounts = [...new Set(asset.holdings.map((holding) => holding.accountName))];
      return [
        asset.instrumentId,
        (counts.get(text) ?? 0) > 1 && accounts.length > 0
          ? `${text} · ${accounts.join(', ')}`
          : text,
      ];
    }),
  );
}

/**
 * INS-SETTINGS: the rules the Dashboard "Insights" card checks: a target share for chosen assets
 * with a tolerance, and returns on cost worth a second look. Leaving everything empty turns
 * the card off.
 */
export default function InsightSettings() {
  const [state, setState] = useState<State>('loading');
  const [assets, setAssets] = useState<AssetValuation[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [drift, setDrift] = useState(DEFAULT_DRIFT);
  const [gain, setGain] = useState('');
  const [loss, setLoss] = useState('');
  const [counter, setCounter] = useState(0);
  const { setInsightRules } = useMainCurrency();

  const fill = (rules: InsightRules | null) => {
    setRows((rules?.targets ?? []).map((target, index) => ({ key: index, ...target })));
    setCounter(rules?.targets.length ?? 0);
    setDrift(rules?.driftPoints ?? DEFAULT_DRIFT);
    setGain(rules?.gainReviewPercent ?? '');
    setLoss(rules?.lossReviewPercent ?? '');
  };

  useEffect(() => {
    let active = true;
    Promise.all([cachedReads.settings.load(), cachedReads.portfolio.load()])
      .then(([settings, portfolio]) => {
        if (!active) return;
        setAssets(portfolio.assets);
        fill(settings.insightRules);
        setState('ready');
      })
      .catch(() => active && setState('failed'));
    return () => {
      active = false;
    };
  }, []);

  const total = rows.reduce(
    (sum, row) => sum + (share.test(row.percent) ? Number(row.percent) : 0),
    0,
  );
  const touch = () => state !== 'saving' && setState('ready');
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const rules = parseForm(rows, drift, gain, loss);
    if (rules === undefined) {
      setState('invalid');
      return;
    }
    setState('saving');
    try {
      const settings = await ownerSettingsApi.update({ insightRules: rules });
      fill(settings.insightRules);
      setInsightRules(settings.insightRules);
      setState('saved');
    } catch {
      setState('save-failed');
    }
  };
  const hint = {
    loading: 'Loading your rules…',
    ready:
      'Targets and review levels the Dashboard checks. Leave everything empty to turn Insights off.',
    saving: 'Saving…',
    saved: 'Saved. The Dashboard checks these rules against your portfolio.',
    invalid:
      'Check the numbers: each target is 0.01 to 100 on its own asset, together at most 100; the tolerance is up to 50 points; the loss level is below 100.',
    failed: 'Could not load the insight rules; try again later.',
    'save-failed': 'Could not save the insight rules; nothing changed.',
  }[state];
  const alert = state === 'invalid' || state === 'failed' || state === 'save-failed';
  const busy = state === 'loading' || state === 'failed' || state === 'saving';
  const labels = optionLabels(assets);
  const free = (current: string) =>
    assets.filter(
      (asset) =>
        asset.instrumentId === current ||
        !rows.some((row) => row.instrumentId === asset.instrumentId),
    );

  return (
    <form
      className="shell-setting insight-settings"
      onSubmit={(event) => void save(event)}
      noValidate
    >
      <div className="shell-setting__text">
        <span className="shell-setting__label">Rules</span>
        <p className="shell-setting__hint" role={alert ? 'alert' : undefined}>
          {hint}
        </p>
        <p className="shell-setting__hint">
          Computed from your own numbers. Insights do not predict prices and are not financial
          advice.
        </p>
      </div>
      <div className="insight-settings__fields">
        <fieldset disabled={busy}>
          <legend>Target shares</legend>
          {rows.map((row, index) => (
            <div className="insight-settings__row" key={row.key}>
              <select
                aria-label={`Target asset ${index + 1}`}
                value={row.instrumentId}
                onChange={(event) => {
                  setRows(
                    rows.map((item) =>
                      item.key === row.key ? { ...item, instrumentId: event.target.value } : item,
                    ),
                  );
                  touch();
                }}
              >
                <option value="">Choose an asset</option>
                {free(row.instrumentId).map((asset) => (
                  <option key={asset.instrumentId} value={asset.instrumentId}>
                    {labels.get(asset.instrumentId)}
                  </option>
                ))}
              </select>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                aria-label={`Target share of ${index + 1}, percent`}
                value={row.percent}
                onChange={(event) => {
                  setRows(
                    rows.map((item) =>
                      item.key === row.key ? { ...item, percent: event.target.value } : item,
                    ),
                  );
                  touch();
                }}
              />
              <span aria-hidden="true">%</span>
              <button
                type="button"
                className="shell-button shell-button--secondary"
                onClick={() => {
                  setRows(rows.filter((item) => item.key !== row.key));
                  touch();
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <div className="insight-settings__row">
            <button
              type="button"
              className="shell-button shell-button--secondary"
              disabled={rows.length >= Math.min(assets.length, 50)}
              onClick={() => {
                setRows([...rows, { key: counter, instrumentId: '', percent: '' }]);
                setCounter(counter + 1);
                touch();
              }}
            >
              Add target
            </button>
            {rows.length > 0 && (
              <span className="shell-setting__hint">
                {total > 100
                  ? `Together ${total}%: more than the whole portfolio.`
                  : `Together ${total}%; the other ${Math.round((100 - total) * 100) / 100}% is everything else.`}
              </span>
            )}
          </div>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>When to look</legend>
          <label className="insight-settings__row">
            <span>Tolerance, points from a target</span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={drift}
              onChange={(event) => {
                setDrift(event.target.value);
                touch();
              }}
            />
          </label>
          <label className="insight-settings__row">
            <span>Review an asset up by, percent on cost</span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="Off"
              value={gain}
              onChange={(event) => {
                setGain(event.target.value);
                touch();
              }}
            />
          </label>
          <label className="insight-settings__row">
            <span>Review an asset down by, percent on cost</span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="Off"
              value={loss}
              onChange={(event) => {
                setLoss(event.target.value);
                touch();
              }}
            />
          </label>
        </fieldset>
        <div>
          <button type="submit" className="shell-button shell-button--secondary" disabled={busy}>
            Save rules
          </button>
        </div>
      </div>
    </form>
  );
}
