import type { HistoricalSnapshot } from '@api/historical-accounting.api';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoricalAccounting } from './HistoricalAccounting';

const api = vi.hoisted(() => ({ snapshot: vi.fn() }));
vi.mock('@api/historical-accounting.api', () => ({ historicalAccountingApi: api }));

const at = '2025-01-02T00:00:00.000Z';
const snapshot: HistoricalSnapshot = {
  accountId: 'account-a',
  at,
  coverageFrom: '2025-01-01T00:00:00.000Z',
  journalRevision: 2,
  basis: 'current-effective-history',
  originKind: 'declared-empty',
  openingRevision: null,
  initialCostUsd: '0',
  summary: {
    grossBuysUsd: '100',
    buyFeesUsd: '0',
    grossSalesUsd: '0',
    sellFeesUsd: '0',
    netSalesUsd: '0',
    consumedCostUsd: '0',
    realizedUsd: '0',
    remainingCostUsd: '100',
  },
  items: [
    {
      instrumentId: 'instrument-a',
      instrumentName: '<literal name>',
      instrumentSymbol: null,
      quantity: '1',
      costUsd: '100',
    },
  ],
  nextOffset: 50,
};

function fillAndSubmit(value = at) {
  fireEvent.change(screen.getByLabelText('Момент времени (ISO, с часовым поясом)'), {
    target: { value },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Показать учётный срез' }));
}

describe('historical accounting view', () => {
  beforeEach(() => api.snapshot.mockReset());
  afterEach(cleanup);

  it('ignores a late result after the instant changes and requires explicit refresh', async () => {
    let complete: (value: HistoricalSnapshot) => void = () => {};
    api.snapshot.mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    render(<HistoricalAccounting accountId="account-a" journalRevision={2} />);
    fillAndSubmit();
    fireEvent.change(screen.getByLabelText('Момент времени (ISO, с часовым поясом)'), {
      target: { value: '2025-01-03T00:00:00Z' },
    });
    await act(async () => complete(snapshot));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(api.snapshot).toHaveBeenCalledTimes(1);
  });

  it('pins continuation and clears it on a 409 until explicit refresh', async () => {
    api.snapshot.mockResolvedValueOnce(snapshot).mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 409 },
    });
    render(<HistoricalAccounting accountId="account-a" journalRevision={2} />);
    fillAndSubmit();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('<literal name>')).toBeVisible();
    expect(table.querySelector('literal')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Следующая страница' }));
    await waitFor(() => expect(screen.queryByRole('table')).not.toBeInTheDocument());
    expect(api.snapshot).toHaveBeenNthCalledWith(1, 'account-a', at, 0, undefined);
    expect(api.snapshot).toHaveBeenNthCalledWith(2, 'account-a', at, 50, 2);
    expect(screen.getByRole('alert')).toHaveTextContent('явно обновите срез');
    expect(api.snapshot).toHaveBeenCalledTimes(2);
  });

  it('invalidates a loaded snapshot when the observed revision changes', async () => {
    api.snapshot.mockResolvedValue(snapshot);
    const view = render(<HistoricalAccounting accountId="account-a" journalRevision={2} />);
    fillAndSubmit();
    expect(await screen.findByRole('table')).toBeVisible();
    view.rerender(<HistoricalAccounting accountId="account-a" journalRevision={3} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('ignores a late response after switching accounts', async () => {
    let complete: (value: HistoricalSnapshot) => void = () => {};
    api.snapshot.mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const view = render(<HistoricalAccounting accountId="account-a" journalRevision={2} />);
    fillAndSubmit();
    view.rerender(<HistoricalAccounting accountId="account-b" journalRevision={2} />);
    await act(async () => complete(snapshot));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(api.snapshot).toHaveBeenCalledTimes(1);
  });
});
