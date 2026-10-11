import type { OperationRange } from '@api/operations.api';
import { useState } from 'react';
import { presetOf, presets } from './period';

const ALL = 'all';
const CUSTOM = 'custom';

/**
 * OPS-PERIOD: which days the list shows. A preset or a custom range; none is the whole history.
 * Dates are UTC days, as the list's own dates are.
 */
export default function PeriodFilter({
  period,
  today,
  onChange,
}: {
  period: OperationRange | undefined;
  /** The current UTC day, YYYY-MM-DD. */
  today: string;
  onChange: (period: OperationRange | undefined) => void;
}) {
  // "Custom range" can be chosen before any date is picked, so it is remembered here.
  const [custom, setCustom] = useState(false);
  const preset = presetOf(period, today);
  const choice = custom ? CUSTOM : period ? (preset ?? CUSTOM) : ALL;
  const choose = (key: string) => {
    setCustom(key === CUSTOM);
    if (key === CUSTOM) return;
    onChange(presets.find((item) => item.key === key)?.range(today));
  };
  // The other end follows when one is moved past it.
  const edit = (end: 'from' | 'to', value: string) => {
    const next: OperationRange = { ...period, [end]: value || undefined };
    if (next.from && next.to && next.from > next.to) next[end === 'from' ? 'to' : 'from'] = value;
    onChange(
      next.from || next.to
        ? { ...(next.from && { from: next.from }), ...(next.to && { to: next.to }) }
        : undefined,
    );
  };
  return (
    <>
      <label className="transactions-filter">
        <span>Period</span>
        <select value={choice} onChange={(event) => choose(event.target.value)}>
          <option value={ALL}>All time</option>
          {presets.map(({ key, label }) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
          <option value={CUSTOM}>Custom range</option>
        </select>
      </label>
      {choice === CUSTOM && (
        <>
          <label className="transactions-filter">
            <span>From</span>
            <input
              type="date"
              value={period?.from ?? ''}
              max={period?.to}
              onChange={(event) => edit('from', event.target.value)}
            />
          </label>
          <label className="transactions-filter">
            <span>To</span>
            <input
              type="date"
              value={period?.to ?? ''}
              min={period?.from}
              onChange={(event) => edit('to', event.target.value)}
            />
          </label>
        </>
      )}
    </>
  );
}
