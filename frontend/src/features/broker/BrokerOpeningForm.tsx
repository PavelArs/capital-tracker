import type { TBankImportPreview, TBankOpening } from '@api/brokers.api';
import { type FormEvent, useState } from 'react';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Input, Select } from '@/ui/inputs';

/** Read-only review; the eventual import saves the opening and history in one command. */
export default function BrokerOpeningForm({
  assets,
  initial,
  busy,
  onReview,
  onCancel,
}: {
  assets: NonNullable<TBankImportPreview['openingAssets']>;
  initial?: TBankOpening;
  busy: boolean;
  onReview: (opening: TBankOpening) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState(() => (initial?.lots ?? [null]).map((_, index) => index));
  const [next, setNext] = useState(rows.length);
  const day = (instant?: string) =>
    instant ? new Date(new Date(instant).getTime() + 3 * 3600000).toISOString().slice(0, 10) : '';
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const date = (name: string) => `${data.get(name)}T00:00:00+03:00`;
    onReview({
      asOf: date('opening-date'),
      lots: rows.map((row) => ({
        asset: String(data.get(`asset-${row}`)),
        acquiredAt: date(`date-${row}`),
        quantity: String(data.get(`quantity-${row}`)).trim(),
        costUsd: String(data.get(`cost-${row}`)).trim(),
      })),
    });
  };
  return (
    <form onSubmit={submit} aria-label="Opening holdings" className="broker-opening">
      <h3>Holdings before this history</h3>
      <Banner tone="info">
        Enter only holdings already present before the imported history. Use the quantity still held
        and its remaining purchase cost in USD. Unknown cost must stay blank; never enter zero
        unless the cost was actually zero. Transfers during the imported period still need
        reconciliation.
      </Banner>
      <Field
        label="Opening date (Moscow)"
        hint="Must be no later than the first imported operation."
      >
        {(control) => (
          <Input
            {...control}
            type="date"
            name="opening-date"
            required
            defaultValue={day(initial?.asOf)}
            disabled={busy}
          />
        )}
      </Field>
      {rows.map((row, index) => (
        <fieldset key={row} disabled={busy} className="broker-opening__lot">
          <legend>Opening lot {index + 1}</legend>
          <Field label="Asset">
            {(control) => (
              <Select
                {...control}
                name={`asset-${row}`}
                defaultValue={initial?.lots[row]?.asset ?? assets[0]?.asset}
              >
                {assets.map((asset) => (
                  <option key={asset.asset} value={asset.asset}>
                    {asset.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Acquired on (Moscow)">
            {(control) => (
              <Input
                {...control}
                type="date"
                name={`date-${row}`}
                defaultValue={day(initial?.lots[row]?.acquiredAt)}
                required
              />
            )}
          </Field>
          <Field label="Quantity still held">
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                name={`quantity-${row}`}
                defaultValue={initial?.lots[row]?.quantity ?? ''}
                pattern="(?:0|[1-9][0-9]*)(?:\.[0-9]{1,30})?"
                required
              />
            )}
          </Field>
          <Field label="Remaining purchase cost (USD)">
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                name={`cost-${row}`}
                defaultValue={initial?.lots[row]?.costUsd ?? ''}
                pattern="(?:0|[1-9][0-9]*)(?:\.[0-9]{1,30})?"
                required
              />
            )}
          </Field>
          {rows.length > 1 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRows((value) => value.filter((item) => item !== row))}
            >
              Remove lot {index + 1}
            </Button>
          )}
        </fieldset>
      ))}
      <div className="ui-toolbar">
        <Button
          size="sm"
          disabled={busy || rows.length >= 100}
          onClick={() => {
            setRows((value) => [...value, next]);
            setNext((value) => value + 1);
          }}
        >
          Add lot
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel opening
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Reviewing…' : 'Review opening holdings'}
        </Button>
      </div>
      <small className="ui-sub">
        Review saves nothing. The final import records these lots and the broker history atomically.
      </small>
    </form>
  );
}
