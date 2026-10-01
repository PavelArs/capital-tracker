import {
  type Journal,
  type RewardCurrentLot,
  type TransferCurrentLot,
  tradesApi,
} from '@api/trades.api';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TradeResults } from './TradeResults';

const transferLot: TransferCurrentLot = {
  sourceKind: 'transfer',
  instrumentId: 'instrument-btc',
  instrumentName: 'Bitcoin',
  instrumentSymbol: 'BTC',
  origin: {
    accountId: 'source-account',
    kind: 'trade',
    tradeId: 'origin-trade',
    version: 2,
    acquiredAt: '2025-01-02T00:00:00.000Z',
    orderWithinTimestamp: 1,
    originalQuantity: '1',
    originalCostUsd: '120',
  },
  arrival: { transferId: 'received-transfer', version: 3 },
  intervalStart: '0.5',
  intervalEnd: '1',
  remainingQuantity: '0.5',
  remainingCostUsd: '60',
};

const journal: Journal = {
  accountId: 'recipient-account',
  requestId: 'origin-request',
  originKind: 'declared-empty',
  coverageFrom: '2025-01-01T00:00:00.000Z',
  createdAt: '2025-01-01T00:00:00.000Z',
  journalRevision: 3,
  activeTradeCount: 0,
  versionCount: 2,
  limits: { activeTrades: 10000, versions: 10000 },
  summary: {
    grossBuysUsd: '0',
    buyFeesUsd: '0',
    grossSalesUsd: '0',
    sellFeesUsd: '0',
    netSalesUsd: '0',
    consumedCostUsd: '0',
    realizedUsd: '0',
    remainingCostUsd: '60',
  },
  transferSummary: {
    receivedBasisUsd: '60',
    sentBasisUsd: '0',
    feeConsumedBasisUsd: '0',
    fees: [],
  },
  revisionBudget: { used: 3, limit: 10000 },
};

describe('TradeResults transfer fragments', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders origin and arrival provenance without treating a transfer as carry-in or a trade', async () => {
    vi.spyOn(tradesApi, 'trades').mockResolvedValue({
      journalRevision: 3,
      items: [],
      nextOffset: null,
    });
    vi.spyOn(tradesApi, 'lots').mockResolvedValue({
      journalRevision: 3,
      items: [transferLot],
      nextOffset: null,
    });
    vi.spyOn(tradesApi, 'realizations').mockResolvedValue({
      journalRevision: 3,
      items: [],
      nextOffset: null,
    });

    render(
      <TradeResults
        accountId={journal.accountId}
        journal={journal}
        disabled={false}
        mutationDisabled={false}
        onCorrect={vi.fn()}
        onVoid={vi.fn()}
        onStale={vi.fn()}
      />,
    );

    const lots = screen.getByRole('table', { name: 'Открытые лоты' });
    const row = await within(lots).findByRole('row', { name: /origin-trade/ });
    expect(row).toHaveTextContent('Исходный счёт source-account');
    expect(row).toHaveTextContent('Сделка origin-trade, версия 2');
    expect(row).toHaveTextContent('Получено переводом received-transfer, версия 3');
    expect(row).toHaveTextContent('Интервал исходного лота: 0.5–1');
    expect(row).toHaveTextContent('0.5');
    expect(row).toHaveTextContent('60');
    expect(within(lots).getByRole('columnheader', { name: 'Источник лота' })).toBeVisible();

    expect(screen.getByText('Сохранённые версии сделок').nextElementSibling).toHaveTextContent('2');
    expect(screen.getByText('Использованные ревизии журнала').nextElementSibling).toHaveTextContent(
      '3 / 10000',
    );
  });

  it('keeps unknown reward cost distinct from known zero and labels partial totals', async () => {
    const rewardLot: RewardCurrentLot = {
      sourceKind: 'reward',
      instrumentId: 'reward-asset',
      instrumentName: 'Reward asset',
      instrumentSymbol: null,
      origin: {
        accountId: journal.accountId,
        kind: 'reward',
        rewardId: 'reward-1',
        version: 1,
        category: 'staking',
        acquiredAt: '2025-01-02T00:00:00.000Z',
        orderWithinTimestamp: 0,
        originalQuantity: '2',
        originalCostUsd: null,
      },
      intervalStart: '0',
      intervalEnd: '2',
      remainingQuantity: '2',
      remainingCostUsd: null,
    };
    const zeroLot: RewardCurrentLot = {
      ...rewardLot,
      origin: {
        ...rewardLot.origin,
        rewardId: 'reward-2',
        orderWithinTimestamp: 1,
        originalCostUsd: '0',
      },
      remainingCostUsd: '0',
    };
    vi.spyOn(tradesApi, 'trades').mockResolvedValue({
      journalRevision: 3,
      items: [],
      nextOffset: null,
    });
    vi.spyOn(tradesApi, 'lots').mockResolvedValue({
      journalRevision: 3,
      items: [rewardLot, zeroLot],
      nextOffset: null,
    });
    vi.spyOn(tradesApi, 'realizations').mockResolvedValue({
      journalRevision: 3,
      items: [],
      nextOffset: null,
    });

    render(
      <TradeResults
        accountId={journal.accountId}
        journal={{
          ...journal,
          summary: {
            ...journal.summary,
            remainingCostUsd: null,
            basisCoverage: {
              consumed: { knownSubtotalUsd: '0', unknownCount: 0 },
              remaining: { knownSubtotalUsd: '0', unknownCount: 1 },
              realized: { knownSubtotalUsd: '0', unknownCount: 0 },
            },
          },
          rewardSummary: {
            activeCount: 2,
            declaredBasisUsd: null,
            declaredIncomeUsd: '0',
            knownBasisSubtotalUsd: '0',
            knownIncomeSubtotalUsd: '0',
            unknownBasisCount: 1,
            unknownIncomeCount: 0,
            unclassifiedCount: 0,
          },
        }}
        disabled={false}
        mutationDisabled={false}
        onCorrect={vi.fn()}
        onVoid={vi.fn()}
        onStale={vi.fn()}
      />,
    );

    const lots = screen.getByRole('table', { name: 'Открытые лоты' });
    const unknown = await within(lots).findByRole('row', { name: /reward-1/ });
    const knownZero = within(lots).getByRole('row', { name: /reward-2/ });
    expect(unknown).toHaveTextContent('Вознаграждение reward-1, версия 1');
    expect(within(unknown).getAllByRole('cell').at(-1)).toHaveTextContent('Неизвестно');
    expect(within(knownZero).getAllByRole('cell').at(-1)).toHaveTextContent('0');
    expect(screen.getByText('Остаточная учётная стоимость').nextElementSibling).toHaveTextContent(
      'Известная часть: 0 USD; неизвестных частей: 1.',
    );
  });
});
