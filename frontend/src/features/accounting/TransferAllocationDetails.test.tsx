import type { TransferAllocation } from '@api/owned-transfers.api';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TransferAllocationDetails } from './TransferAllocationDetails';

it('shows unknown reward basis, its known subtotal and exact zero fee without losing origin', () => {
  const allocation: TransferAllocation = {
    transferId: 'transfer-1',
    version: 2,
    fromJournalRevision: 4,
    toJournalRevision: 3,
    principalBasisUsd: null,
    feeConsumedBasisUsd: '0',
    basisCoverage: {
      principal: { knownSubtotalUsd: '7', unknownCount: 1 },
      fee: { knownSubtotalUsd: '0', unknownCount: 0 },
    },
    items: [
      {
        kind: 'principal',
        instrumentId: 'instrument-1',
        quantity: '2',
        costUsd: null,
        origin: {
          accountId: 'source-account',
          kind: 'reward',
          rewardId: 'reward-1',
          version: 3,
          category: 'staking',
          acquiredAt: '2025-01-01T00:00:00.000Z',
          orderWithinTimestamp: 0,
          originalQuantity: '2',
          originalCostUsd: null,
        },
        intervalStart: '0',
        intervalEnd: '2',
        arrival: null,
      },
    ],
    nextOffset: null,
  };

  render(<TransferAllocationDetails allocation={allocation} loading={false} onNext={vi.fn()} />);

  expect(
    screen.getByText('Себестоимость переданного актива, USD').nextElementSibling,
  ).toHaveTextContent('Неизвестно');
  expect(
    screen.getByText('Себестоимость переданного актива, USD').nextElementSibling,
  ).toHaveTextContent('Известная часть: 7 USD; неизвестных частей: 1.');
  expect(
    screen.getByText('Списанная себестоимость комиссии, USD').nextElementSibling,
  ).toHaveTextContent('0');
  expect(screen.getByText('Вознаграждение reward-1, версия 3')).toBeVisible();
  expect(screen.getByText('Исходный счёт source-account')).toBeVisible();
});
