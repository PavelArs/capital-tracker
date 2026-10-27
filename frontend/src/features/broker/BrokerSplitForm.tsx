import type { TBankImportPreview, TBankSplit } from '@api/brokers.api';
import type { FormEvent } from 'react';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Input, Select } from '@/ui/inputs';

/** SPLIT: one share split of a security in this history. Review saves nothing. */
export default function BrokerSplitForm({
  assets,
  initial,
  busy,
  onReview,
  onCancel,
}: {
  assets: NonNullable<TBankImportPreview['openingAssets']>;
  initial?: TBankSplit;
  busy: boolean;
  onReview: (split: TBankSplit) => void;
  onCancel: () => void;
}) {
  // Only shares and funds split.
  const securities = assets.filter((asset) => ['share', 'etf'].includes(asset.type));
  const day = (instant?: string) =>
    instant ? new Date(new Date(instant).getTime() + 3 * 3600000).toISOString().slice(0, 10) : '';
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onReview({
      asset: String(data.get('split-asset')),
      effectiveAt: `${data.get('split-date')}T00:00:00+03:00`,
      ratio: Number(data.get('split-ratio')),
    });
  };
  return (
    <form onSubmit={submit} aria-label="Share split" className="broker-opening">
      <h3>Share split</h3>
      <Banner tone="info">
        From this date every share held became this many shares, at the same total cost. T-Bank does
        not list splits, so check the date in the company's or the exchange's notice.
      </Banner>
      <Field label="Security">
        {(control) => (
          <Select {...control} name="split-asset" defaultValue={initial?.asset} disabled={busy}>
            {securities.map((asset) => (
              <option key={asset.asset} value={asset.asset}>
                {asset.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Effective from (Moscow)" hint="The first day the new shares traded.">
        {(control) => (
          <Input
            {...control}
            type="date"
            name="split-date"
            required
            defaultValue={day(initial?.effectiveAt)}
            disabled={busy}
          />
        )}
      </Field>
      <Field label="New shares for each old one" hint="10 for a 1:10 split.">
        {(control) => (
          <Input
            {...control}
            type="number"
            name="split-ratio"
            min={2}
            max={1000000}
            step={1}
            required
            defaultValue={initial?.ratio ?? 10}
            disabled={busy}
          />
        )}
      </Field>
      <div className="ui-toolbar">
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel split
        </Button>
        <span className="ui-grow" />
        <Button type="submit" variant="primary" busy={busy}>
          Review split
        </Button>
      </div>
    </form>
  );
}
