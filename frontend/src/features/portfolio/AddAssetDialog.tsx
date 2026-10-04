import {
  type AssetType,
  type NewPortfolioAsset,
  type PortfolioAsset,
  portfolioAssetsApi,
  type ValuationCurrency,
} from '@api/portfolio-assets.api';
import { isAxiosError } from 'axios';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { newRequestId } from '../accounting/feedback';

const types: [AssetType, string, string][] = [
  [
    'crypto',
    'Crypto',
    'BTC, ETH, SOL, USDT, USDC, ZEC, TRX and XLM get market prices. Other coins are valued by hand.',
  ],
  ['fiat', 'Cash', 'Cash is worth exactly its amount in its own currency.'],
  ['manual', 'Manual', 'For a deposit or anything else whose value you enter by hand.'],
];
const currencies: ValuationCurrency[] = ['USD', 'EUR', 'RUB'];
// Tab order inside the modal: a radio group is one stop, at its checked radio.
const focusableFields =
  'button:not([disabled]), input:not([disabled]):not([type="radio"]), input[type="radio"]:checked';

function failure(error: unknown): string {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  if (status === undefined)
    return 'Could not reach the server. Try again; the same request will not add the asset twice.';
  if (status === 400) return 'Check the fields and try again.';
  if (status === 409) return 'This request conflicts with an asset already saved. Reload the page.';
  if (status === 401) return 'Your session has ended. Sign in again.';
  return 'Could not add the asset. Try again.';
}

interface Props {
  onClose: () => void;
  onAdded: (asset: PortfolioAsset) => void;
}

// "Add asset" from the accepted prototype, limited to what M2 stores (AST-3).
export default function AddAssetDialog({ onClose, onAdded }: Props) {
  const [assetType, setAssetType] = useState<AssetType>('crypto');
  const [name, setName] = useState('');
  const [ticker, setTicker] = useState('');
  const [currency, setCurrency] = useState<ValuationCurrency>('USD');
  const [invalid, setInvalid] = useState<{ name?: string; ticker?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // One request id per distinct body, so a retry after a lost answer cannot duplicate.
  const attempt = useRef<{ body: string; requestId: string } | null>(null);
  const nameField = useRef<HTMLInputElement>(null);

  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const busy = useRef(false);
  busy.current = saving;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    nameField.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      // Closing mid-save would let a reopened form send a second request id.
      if (event.key === 'Escape' && !busy.current) close.current();
      if (event.key !== 'Tab' || !dialog.current) return;
      const focusable = [...dialog.current.querySelectorAll<HTMLElement>(focusableFields)];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedTicker = ticker.trim().toUpperCase();
    const problems = {
      ...(name.trim() ? {} : { name: 'Enter a name' }),
      ...(assetType === 'crypto' && !trimmedTicker ? { ticker: 'Enter a ticker' } : {}),
    };
    setInvalid(problems);
    if (Object.keys(problems).length) return;
    const body: Omit<NewPortfolioAsset, 'requestId'> = {
      name: name.trim(),
      assetType,
      ...(assetType === 'fiat' ? { symbol: currency } : {}),
      ...(assetType !== 'fiat' && trimmedTicker ? { symbol: trimmedTicker } : {}),
      ...(assetType === 'manual' ? { valuationCurrency: currency } : {}),
    };
    const key = JSON.stringify(body);
    if (attempt.current?.body !== key) attempt.current = { body: key, requestId: newRequestId() };
    setSaving(true);
    setError(null);
    try {
      onAdded(await portfolioAssetsApi.create({ requestId: attempt.current.requestId, ...body }));
    } catch (caught) {
      setError(failure(caught));
      setSaving(false);
    }
  };

  const hint = types.find(([value]) => value === assetType)?.[2];
  return (
    <div className="portfolio-scrim">
      <div
        ref={dialog}
        className="portfolio-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-asset"
      >
        <form onSubmit={submit} noValidate>
          <div className="portfolio-dialog__head">
            <h2 id="add-asset">Add asset</h2>
          </div>
          <div className="portfolio-dialog__body">
            <div className="portfolio-field">
              <span id="add-asset-type" className="portfolio-field__label">
                Type
              </span>
              <div className="shell-seg" role="radiogroup" aria-labelledby="add-asset-type">
                {types.map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name="asset-type"
                      value={value}
                      checked={assetType === value}
                      onChange={() => setAssetType(value)}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <span className="portfolio-field__hint">{hint}</span>
            </div>
            <div className="portfolio-row">
              <div className="portfolio-field">
                <label className="portfolio-field__label" htmlFor="add-asset-name">
                  Name
                </label>
                <input
                  id="add-asset-name"
                  ref={nameField}
                  className="portfolio-input"
                  maxLength={120}
                  placeholder={assetType === 'manual' ? 'e.g. Bank deposit' : 'e.g. Bitcoin'}
                  value={name}
                  aria-invalid={invalid.name ? true : undefined}
                  onChange={(event) => setName(event.target.value)}
                />
                {invalid.name && <span className="portfolio-field__error">{invalid.name}</span>}
              </div>
              {assetType !== 'fiat' && (
                <div className="portfolio-field">
                  <label className="portfolio-field__label" htmlFor="add-asset-ticker">
                    {assetType === 'crypto' ? 'Ticker' : 'Ticker (optional)'}
                  </label>
                  <input
                    id="add-asset-ticker"
                    className="portfolio-input"
                    maxLength={32}
                    placeholder={assetType === 'crypto' ? 'e.g. BTC' : ''}
                    value={ticker}
                    aria-invalid={invalid.ticker ? true : undefined}
                    onChange={(event) => setTicker(event.target.value)}
                  />
                  {invalid.ticker && (
                    <span className="portfolio-field__error">{invalid.ticker}</span>
                  )}
                </div>
              )}
            </div>
            {assetType !== 'crypto' && (
              <div className="portfolio-field">
                <span id="add-asset-currency" className="portfolio-field__label">
                  Currency
                </span>
                <div className="shell-seg" role="radiogroup" aria-labelledby="add-asset-currency">
                  {currencies.map((code) => (
                    <label key={code}>
                      <input
                        type="radio"
                        name="asset-currency"
                        value={code}
                        checked={currency === code}
                        onChange={() => setCurrency(code)}
                      />
                      {code}
                    </label>
                  ))}
                </div>
                <span className="portfolio-field__hint">
                  {assetType === 'fiat'
                    ? 'The currency is also the ticker.'
                    : 'The currency its value is entered in.'}
                </span>
              </div>
            )}
            {error && (
              <p className="portfolio-dialog__error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="portfolio-dialog__foot">
            <button
              type="button"
              className="shell-button shell-button--ghost"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className="shell-button shell-button--primary" disabled={saving}>
              Add asset
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
