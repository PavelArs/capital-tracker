import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { AssetSwapFields } from './AssetSwapEvidence';
import { AssetSwapForm } from './AssetSwapForm';
import { AssetSwapTotals } from './AssetSwapTotals';
import { AllocationOrigin } from './TransferAllocationDetails';
import { type SwapDraft, emptySwapDraft } from './swap-draft';

it('SWAP-004 shows separate unknown result evidence and preserves a transferred original swap interval', () => {
  const known = { knownSubtotalUsd: '0', unknownCount: 0 };
  render(
    <>
      <dl>
        <AssetSwapTotals
          summary={{
            activeCount: 2,
            considerationUsd: null,
            principalBasisUsd: '100',
            feeConsumedBasisUsd: '0',
            realizedUsd: null,
            coverage: {
              consideration: { knownSubtotalUsd: '10', unknownCount: 1 },
              principal: { knownSubtotalUsd: '100', unknownCount: 0 },
              fee: known,
              realized: { knownSubtotalUsd: '7', unknownCount: 1 },
            },
          }}
        />
      </dl>
      <AllocationOrigin
        item={{
          kind: 'principal',
          instrumentId: 'incoming',
          quantity: '1',
          costUsd: null,
          origin: {
            accountId: 'original-account',
            kind: 'swap',
            swapId: 'original-swap',
            version: 2,
            acquiredAt: '2025-01-03T00:00:00.000Z',
            orderWithinTimestamp: 1,
            originalQuantity: '3',
            originalCostUsd: null,
          },
          intervalStart: '0.1',
          intervalEnd: '1.1',
          arrival: { transferId: 'last-arrival', version: 3 },
        }}
      />
    </>,
  );
  expect(
    screen.getByText('Реализованный результат обменов, USD').nextElementSibling,
  ).toHaveTextContent('НеизвестноИзвестная часть: 7 USD; неизвестных частей: 1.');
  expect(
    screen.getByText('Списанная себестоимость комиссий обменов, USD').nextElementSibling,
  ).toHaveTextContent(/^0$/);
  expect(screen.getByText('Обмен original-swap, версия 2')).toBeVisible();
  expect(screen.getByText('Получено переводом last-arrival, версия 3')).toBeVisible();
  expect(screen.getByText('Интервал исходного лота: 0.1–1.1')).toBeVisible();
});

it('SWAP-005 renders UUIDs and exact unknown/zero evidence without turning a ticker into identity', () => {
  const draft = {
    ...emptySwapDraft(),
    outgoingInstrumentId: 'outgoing-id',
    incomingInstrumentId: 'incoming-id',
    outgoingQuantity: '0.000000000000000000000000000001',
    incomingQuantity: '3',
    considerationKnown: true,
    considerationUsd: '0',
    feeSource: 'incoming' as const,
    feeInstrumentId: 'incoming-id',
    feeQuantity: '0.1',
  };
  const { rerender } = render(
    <dl>
      <AssetSwapFields draft={draft} instrumentName={() => 'SAME'} />
    </dl>,
  );
  expect(screen.getByText('Отдаваемый актив').nextElementSibling).toHaveTextContent(
    'SAME · outgoing-id',
  );
  expect(screen.getByText('Получаемый актив').nextElementSibling).toHaveTextContent(
    'SAME · incoming-id',
  );
  expect(screen.getByText('Оценка обмена, USD').nextElementSibling).toHaveTextContent(/^0$/);
  expect(screen.getByText('Отдаваемое количество').nextElementSibling).toHaveTextContent(
    draft.outgoingQuantity,
  );
  rerender(
    <dl>
      <AssetSwapFields
        draft={{ ...draft, considerationKnown: false }}
        instrumentName={() => 'SAME'}
      />
    </dl>,
  );
  expect(screen.getByText('Оценка обмена, USD').nextElementSibling).toHaveTextContent('Неизвестно');
});

function ControlledForm() {
  const [draft, setDraft] = useState<SwapDraft>({
    ...emptySwapDraft(),
    incomingInstrumentId: 'one',
  });
  return (
    <>
      <AssetSwapForm
        draft={draft}
        instruments={[
          {
            id: 'one',
            name: 'Первый',
            symbol: 'SAME',
            namespace: 'manual',
            createdAt: '2025-01-01T00:00:00.000Z',
          },
          {
            id: 'two',
            name: 'Второй',
            symbol: 'SAME',
            namespace: 'manual',
            createdAt: '2025-01-01T00:00:00.000Z',
          },
        ]}
        mode="create"
        busy={false}
        reviewed={false}
        onChange={setDraft}
        onReview={() => {}}
        onSubmit={() => {}}
      />
      <output aria-label="Состояние комиссии">
        {draft.feeSource}:{draft.feeInstrumentId}:{draft.feeQuantity}
      </output>
    </>
  );
}

it('SWAP-005 fee source stays explicit, follows the selected incoming asset and resets to exact no-fee fields', async () => {
  const user = userEvent.setup();
  render(<ControlledForm />);
  await user.selectOptions(screen.getByLabelText('Источник комиссии'), 'incoming');
  expect(screen.getByLabelText('Актив комиссии')).toBeDisabled();
  await user.selectOptions(screen.getByLabelText('Получаемый актив'), 'two');
  await user.type(screen.getByLabelText('Количество комиссии'), '0.000000000000000000000000000001');
  expect(screen.getByLabelText('Состояние комиссии')).toHaveTextContent(
    'incoming:two:0.000000000000000000000000000001',
  );
  await user.selectOptions(screen.getByLabelText('Источник комиссии'), 'held');
  expect(screen.getByLabelText('Актив комиссии')).toBeEnabled();
  await user.selectOptions(screen.getByLabelText('Актив комиссии'), 'one');
  await user.selectOptions(screen.getByLabelText('Источник комиссии'), 'none');
  expect(screen.getByLabelText('Состояние комиссии')).toHaveTextContent('none::0');
  expect(screen.getByRole('button', { name: 'Записать обмен' })).toBeDisabled();
});
