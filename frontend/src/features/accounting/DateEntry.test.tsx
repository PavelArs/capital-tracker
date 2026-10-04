import { historicalAccountingApi } from '@api/historical-accounting.api';
import { historicalValuationApi } from '@api/historical-valuation.api';
import { valuationHistoryApi } from '@api/valuation-history.api';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoricalAccounting } from './HistoricalAccounting';
import { HistoricalValuation } from './HistoricalValuation';
import { type TradeDraft, TradeForm, emptyTradeDraft } from './TradeForm';
import { ValuationHistory } from './ValuationHistory';
import { emptySwapDraft } from './swap-draft';

const accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function draftWith(occurredAt: string): TradeDraft {
  return {
    instrumentId: '',
    side: 'buy',
    occurredAt,
    orderWithinTimestamp: '0',
    quantity: '',
    grossUsd: '',
    feeUsd: '0',
  };
}

function ControlledTrade({ initial }: { initial: string }) {
  const [draft, setDraft] = useState(draftWith(initial));
  return (
    <>
      <TradeForm
        draft={draft}
        onChange={setDraft}
        onSubmit={(event) => event.preventDefault()}
        instruments={[]}
        selected={null}
        disabled={false}
        lockDraft={false}
        correction={false}
        onCancel={vi.fn()}
        cancelDisabled={false}
      />
      <output aria-label="instant">{draft.occurredAt}</output>
    </>
  );
}

function moment(name: string, timeName: string) {
  return {
    date: screen.getByLabelText(name) as HTMLInputElement,
    time: screen.getByLabelText(timeName) as HTMLInputElement,
  };
}

const instant = () => screen.getByLabelText('instant').textContent;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('DATE-1 calendar date with optional UTC time', () => {
  it('DATE-1-A picks a date only and stores 00:00 UTC', () => {
    render(<ControlledTrade initial="" />);
    const { date, time } = moment('Дата сделки', 'Время сделки, UTC');
    expect(date).toHaveAttribute('type', 'date');
    expect(time).toHaveAttribute('type', 'time');
    expect(time).toBeDisabled();
    fireEvent.change(date, { target: { value: '2025-06-13' } });
    expect(instant()).toBe('2025-06-13T00:00:00.000Z');
    expect(date).toHaveAccessibleDescription(/00:00 UTC/);
  });

  it('DATE-1-B adds and clears an optional UTC time', () => {
    render(<ControlledTrade initial="2025-06-13T00:00:00.000Z" />);
    const { time } = moment('Дата сделки', 'Время сделки, UTC');
    expect(time).toHaveValue('');
    fireEvent.change(time, { target: { value: '14:30' } });
    expect(instant()).toBe('2025-06-13T14:30:00.000Z');
    fireEvent.change(time, { target: { value: '' } });
    expect(instant()).toBe('2025-06-13T00:00:00.000Z');
  });

  it('DATE-1-C shows and keeps an exact existing instant', () => {
    render(<ControlledTrade initial="2024-02-29T01:02:03.004Z" />);
    const { date, time } = moment('Дата сделки', 'Время сделки, UTC');
    expect(date).toHaveValue('2024-02-29');
    expect(time).toHaveValue('01:02:03.004');
    fireEvent.change(date, { target: { value: '2024-03-01' } });
    expect(instant()).toBe('2024-03-01T01:02:03.004Z');
  });

  it('DATE-1-D asks for no ISO text', () => {
    render(<ControlledTrade initial="" />);
    expect(screen.queryByText(/ISO|T00:00:00|YYYY-MM-DD/)).toBeNull();
    expect(screen.queryByRole('textbox', { name: /Дата|Время/ })).toBeNull();
  });
});

describe('DATE-2 today by default for account analytics', () => {
  const today = new Date('2026-10-04T09:51:00.000Z');

  it('DATE-2-A values the account at today 00:00 UTC only after submission', () => {
    vi.useFakeTimers({ now: today, toFake: ['Date'] });
    const snapshot = vi
      .spyOn(historicalValuationApi, 'snapshot')
      .mockReturnValue(new Promise(() => {}));
    render(<HistoricalValuation accountId={accountId} journalRevision={1} />);
    expect(moment('Дата оценки', 'Время оценки, UTC').date).toHaveValue('2026-10-04');
    expect(snapshot).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Рассчитать стоимость' }));
    expect(snapshot).toHaveBeenCalledWith(accountId, '2026-10-04T00:00:00.000Z');
  });

  it('DATE-2-A takes the accounting snapshot at today 00:00 UTC', () => {
    vi.useFakeTimers({ now: today, toFake: ['Date'] });
    const snapshot = vi
      .spyOn(historicalAccountingApi, 'snapshot')
      .mockReturnValue(new Promise(() => {}));
    render(<HistoricalAccounting accountId={accountId} journalRevision={1} />);
    expect(moment('Дата среза', 'Время среза, UTC').date).toHaveValue('2026-10-04');
    fireEvent.click(screen.getByRole('button', { name: 'Показать учётный срез' }));
    expect(snapshot).toHaveBeenCalledWith(accountId, '2026-10-04T00:00:00.000Z', 0, undefined);
  });

  it('DATE-2-B requests the last seven days of history', () => {
    vi.useFakeTimers({ now: today, toFake: ['Date'] });
    const series = vi.spyOn(valuationHistoryApi, 'series').mockReturnValue(new Promise(() => {}));
    render(<ValuationHistory accountId={accountId} journalRevision={1} />);
    expect(moment('Начало периода', 'Время начала периода, UTC').date).toHaveValue('2026-09-27');
    expect(moment('Конец периода', 'Время конца периода, UTC').date).toHaveValue('2026-10-04');
    fireEvent.click(screen.getByRole('button', { name: 'Показать историю' }));
    expect(series).toHaveBeenCalledWith(
      accountId,
      '2026-09-27T00:00:00.000Z',
      '2026-10-04T00:00:00.000Z',
    );
  });

  it('DATE-2 starts new operation drafts at today 00:00 UTC', () => {
    vi.useFakeTimers({ now: today, toFake: ['Date'] });
    expect(emptyTradeDraft().occurredAt).toBe('2026-10-04T00:00:00.000Z');
    expect(emptySwapDraft().occurredAt).toBe('2026-10-04T00:00:00.000Z');
  });
});
