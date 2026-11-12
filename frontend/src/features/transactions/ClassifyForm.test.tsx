import apiClient from '@api/client';
import { type Operation, operationsApi } from '@api/operations.api';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ClassifyForm, { POOL_DEPOSIT_NAMED } from './ClassifyForm';

// Characterization of the classification form's refusals and messages. Synthetic data only.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cold = { id: id(11), name: 'Cold storage' };
const wallet = {
  id: id(20),
  network: 'bitcoin' as const,
  address: 'bc1qsyntheticwalletaddress000000000f3t4',
  label: null,
};
const receipt: Operation = {
  id: `chain:${wallet.id}:${'1'.padStart(64, 'a')}`,
  kind: 'chain',
  type: null,
  direction: 'in',
  occurredAt: '2025-06-20T08:05:00.000Z',
  orderWithinTimestamp: 0,
  asset: { instrumentId: null, symbol: 'BTC', name: 'Bitcoin' },
  quantity: '0.01',
  counterAsset: null,
  counterQuantity: null,
  valueUsd: null,
  estimatedValueUsd: '600',
  costBasisUsd: null,
  feeUsd: null,
  fee: null,
  paid: null,
  settlement: null,
  comment: null,
  classification: null,
  account: cold,
  counterAccount: null,
  wallet,
  counterWallet: null,
  chain: {
    txid: '1'.padStart(64, 'a'),
    blockHeight: 800001,
    priceObservedAt: '2025-06-20T08:00:00.000Z',
    direction: 'in',
  },
  status: 'needs-classification',
  source: 'chain',
  version: null,
  value: null,
  estimatedValue: '600',
  costBasis: null,
  feeValue: null,
};

const httpError = (status: number, data: object = {}) =>
  new AxiosError('refused', String(status), undefined, undefined, {
    status,
    statusText: 'Refused',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data,
  });
const later = {
  operationId: `trade:${id(50)}`,
  accountId: cold.id,
  instrumentId: id(1),
  occurredAt: '2025-07-01T00:00:00.000Z',
};

function renderForm(operation: Operation = receipt) {
  const user = userEvent.setup();
  const onSaved = vi.fn();
  render(
    <MemoryRouter>
      <ClassifyForm operation={operation} left={1} onSaved={onSaved} onCancel={() => undefined}>
        <p>Facts</p>
      </ClassifyForm>
    </MemoryRouter>,
  );
  return { user, onSaved };
}

const networkAdapter = apiClient.defaults.adapter;
beforeAll(() => {
  apiClient.defaults.adapter = (config) =>
    Promise.reject(new AxiosError('No network in tests', 'ERR_NETWORK', config));
});
afterAll(() => {
  apiClient.defaults.adapter = networkAdapter;
});
beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(cleanup);

describe('ClassifyForm refusals', () => {
  it.each([
    [
      'the account would not hold the coins',
      httpError(409, {
        message: 'An account does not hold enough for this trade',
        dependent: later,
      }),
      'Cold storage does not hold enough BTC on Jul 1, 2025 for this transaction. Classify the receipts that brought the coins there first, or choose another type.',
    ],
    [
      'the records of the account have not started',
      httpError(409, { coverage: { accountId: cold.id, coverageFrom: null } }),
      'The records of Cold storage have not started: it was opened with balances, so start them on Manual accounts first. Until then this transaction can only be hidden.',
    ],
    [
      'the records of the account start later',
      httpError(409, { coverage: { accountId: id(99), coverageFrom: '2026-01-01T00:00:00.000Z' } }),
      'The records of The account start on Jan 1, 2026, after this transaction on Jun 20, 2025. Hide the transaction if its coins are already in that opening balance, or choose another type.',
    ],
    [
      'a later transaction spends the coins',
      httpError(409, { dependent: later }),
      'A later transaction spends these coins, so this answer cannot change now. Change that transaction first.',
    ],
    [
      'no answer',
      new AxiosError('offline'),
      'Could not reach the server. The answer may have been saved; saving it again is safe.',
    ],
    [
      'the wallet has no account',
      httpError(422, { message: 'Choose the account of this wallet first' }),
      'This wallet is not in an account yet. Choose its account, then classify the transaction.',
    ],
    [
      'the other wallet has no account',
      httpError(422, { message: 'Choose the account of the other wallet first' }),
      'The address on the other side is not in a wallet yet. Choose its wallet first.',
    ],
    [
      'the other side moved the same way',
      httpError(422, { message: 'Choose a transaction that moved coins the other way' }),
      'The other transaction moved coins the same way. Choose one that moved them the other way.',
    ],
    [
      'the swap has one coin',
      httpError(422, { message: 'A swap needs two different coins' }),
      'Both transactions moved the same coin. Choose a transaction in another coin.',
    ],
    [
      'the swap has no other side',
      httpError(422, { message: 'Choose the other side of the swap' }),
      'Choose the transaction on the other side.',
    ],
    [
      'the record to replace moved the same way',
      httpError(422, { message: 'Choose a record that moved coins the other way' }),
      'That record moved coins the same way as this transaction. Choose another one.',
    ],
    [
      'the record to replace is too far',
      httpError(422, { message: 'That record is too far from this transaction' }),
      'That record is more than a week from this transaction. Choose another one.',
    ],
    [
      'the record cannot be replaced',
      httpError(422, { message: 'That record cannot be replaced by a swap' }),
      'That record has a fee, an amount stated in RUB or EUR, or a purpose, which a swap cannot keep. Edit it or choose another one.',
    ],
    [
      'later entries need the record',
      httpError(422, {
        message:
          'The books would not hold the coins without that record; change the entries that depend on it first',
      }),
      'Later entries depend on that record, so it cannot be replaced now. Change those entries first.',
    ],
    [
      'the books do not hold the coins',
      httpError(422, {
        message:
          'The books do not hold the coins of this swap at that time; answer the earlier transactions of this wallet first',
      }),
      'The records of this wallet do not hold those coins at that time. Classify its earlier transactions first.',
    ],
    [
      'the record changed',
      httpError(409, { message: 'That record changed; reload and try again' }),
      'That record changed or was already used. Close this window, reload and try again.',
    ],
    [
      'the record is not the owner’s',
      httpError(422, { message: 'Choose an operation you added or imported' }),
      'That record was deleted or was not added by you. Reload and choose another one.',
    ],
    [
      'the record is in another wallet',
      httpError(422, { message: 'Choose an operation of this wallet' }),
      'That record is in another wallet. Choose one of the wallet of this address.',
    ],
    [
      'the record moved another coin',
      httpError(422, { message: 'That operation did not move this coin this way' }),
      'That record did not move this coin this way. Choose another one.',
    ],
    [
      'no pool deposit is named',
      httpError(422, { message: 'Choose a pool deposit' }),
      'Choose the pool deposit this withdrawal returns.',
    ],
    [
      'the deposit was in another coin',
      httpError(422, { message: 'A pool withdrawal returns the coin of its deposit' }),
      'That deposit was in another coin. Choose a deposit of the coin that came back.',
    ],
    [
      'the deposit is of another wallet',
      httpError(422, { message: 'Choose a pool deposit of this wallet' }),
      'That deposit was made from another wallet. Choose a deposit of this wallet.',
    ],
    [
      'the deposit is later',
      httpError(422, { message: 'Choose a pool deposit made before this withdrawal' }),
      'That deposit was made after this withdrawal. Choose an earlier one.',
    ],
    [
      'the deposit was withdrawn',
      httpError(422, { message: 'That pool deposit was already withdrawn' }),
      'Another withdrawal already returns that deposit. Choose another one, or change that withdrawal first.',
    ],
    [
      'a withdrawal names the deposit',
      httpError(422, { message: POOL_DEPOSIT_NAMED }),
      'A pool withdrawal returns this deposit. Change that withdrawal first.',
    ],
    [
      'the other wallet is this one',
      httpError(422, { message: 'Choose an account other than the one of this wallet' }),
      'Choose a wallet other than the one of this address.',
    ],
    [
      'the other wallet did not receive it',
      httpError(422, {
        message: 'The other wallet did not receive what this one sent, less the network fee',
      }),
      'The other wallet did not receive what this one sent, less the network fee. Choose another wallet or another type.',
    ],
    [
      'several addresses took part',
      httpError(422, {
        message: 'Several addresses of that account took part in this transaction',
      }),
      'Several addresses of that wallet took part in this transaction. Choose the address that took the coins; if it is not offered, reload the page.',
    ],
    [
      'the address is not the other side',
      httpError(422, { message: 'That transaction is not the other side of this one' }),
      'That address did not take part in this transfer: it must have moved the same coin the other way, less the network fee. Choose another address or another type.',
    ],
    [
      'no price is stored',
      httpError(422, { message: 'No stored price for this coin at that time' }),
      'There is no stored price for this coin at that time. Enter the value in USD.',
    ],
    [
      'another refusal',
      httpError(422, { message: 'Something else' }),
      'This type does not fit the direction of the transaction.',
    ],
    [
      'a conflict',
      httpError(409, { message: 'Something else' }),
      'This could not be saved: it was changed elsewhere, or the account would not hold enough on that date. Close this window, reload and try again.',
    ],
    ['a server error', httpError(500), 'Could not save the classification. Try again.'],
  ])('says so when %s', async (_case, error, text) => {
    vi.spyOn(operationsApi, 'classify').mockRejectedValue(error);
    const { user, onSaved } = renderForm();
    await user.click(screen.getByRole('button', { name: 'Other' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toBe(text);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('a wallet without an account links to the wallets', async () => {
    vi.spyOn(operationsApi, 'classify').mockRejectedValue(
      httpError(422, { message: 'Choose the account of this wallet first' }),
    );
    const { user } = renderForm();
    await user.click(screen.getByRole('button', { name: 'Other' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const banner = await screen.findByRole('alert');
    expect(within(banner).getByRole('link', { name: 'Choose its account' })).toHaveAttribute(
      'href',
      '/wallets',
    );
  });
});

describe('ClassifyForm problems', () => {
  it('POOL-WITHDRAW: a withdrawal needs its deposit and a gain above zero or none', async () => {
    const classify = vi.spyOn(operationsApi, 'classify').mockResolvedValue();
    const { user } = renderForm();
    await user.click(screen.getByRole('button', { name: 'Pool withdrawal' }));
    await user.type(screen.getByLabelText('Value of the gain (optional)'), '0');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Choose the pool deposit this withdrawal returns')).toBeInTheDocument();
    expect(screen.getByText('Enter a value above zero, or leave it empty')).toBeInTheDocument();
    expect(classify).not.toHaveBeenCalled();
  });

  it('CLS-BUY: a rate in EUR must be above zero when it is given', async () => {
    const classify = vi.spyOn(operationsApi, 'classify').mockResolvedValue();
    const { user } = renderForm();
    await user.click(screen.getByRole('button', { name: 'Buy' }));
    await user.type(screen.getByLabelText('You paid'), '10');
    await user.click(screen.getByRole('radio', { name: 'EUR' }));
    await user.type(screen.getByLabelText('Exchange rate'), '0');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Enter a rate above zero, or leave it empty')).toBeInTheDocument();
    expect(classify).not.toHaveBeenCalled();
  });

  it('a comment longer than 500 characters is refused', async () => {
    const classify = vi.spyOn(operationsApi, 'classify').mockResolvedValue();
    const { user } = renderForm();
    await user.click(screen.getByRole('button', { name: 'Other' }));
    await user.click(screen.getByLabelText('Comment'));
    await user.paste('x'.repeat(501));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('At most 500 characters')).toBeInTheDocument();
    expect(classify).not.toHaveBeenCalled();
  });
});

describe('ClassifyForm hints', () => {
  /** The hint a field reads out with its label. */
  const hintOf = (label: string) =>
    document.getElementById(screen.getByLabelText(label).getAttribute('aria-describedby') ?? '')
      ?.textContent;
  const payment = {
    ...receipt,
    id: `chain:${wallet.id}:${'2'.padStart(64, 'a')}`,
    direction: 'out' as const,
    chain: { ...receipt.chain!, txid: '2'.padStart(64, 'a'), direction: 'out' as const },
  };

  const unpriced = {
    ...receipt,
    estimatedValueUsd: null,
    estimatedValue: null,
    marketValue: { valueUsd: '612.5', observedAt: '2026-10-04T11:00:00.000Z' },
  };

  it.each([
    [
      'a receipt',
      'Income',
      receipt,
      'Value at the time',
      'What the coins were worth on Jun 20, 2025; it becomes their cost basis.',
    ],
    [
      'a receipt',
      'Reward',
      receipt,
      'Value at the time (optional)',
      'Without a value the coins count in net worth, not in profit.',
    ],
    [
      'a receipt',
      'Pool withdrawal',
      receipt,
      'Value of the gain (optional)',
      'Only what came back above the deposit is income; less is a loss. Empty: USDT and USDC count 1:1, other coins at their stored price on Jun 20, 2025.',
    ],
    [
      'a receipt',
      'Swap',
      receipt,
      'Value at the time (optional)',
      'Empty: USDT and USDC count 1:1, other coins at their stored price on Jun 20, 2025.',
    ],
    [
      'a payment',
      'Expense',
      payment,
      'Value at the time',
      'What the coins were worth on Jun 20, 2025; it leaves your capital.',
    ],
    [
      'a payment',
      'Fee',
      payment,
      'Value at the time (optional)',
      'Empty: USDT and USDC count 1:1, other coins at their stored price on Jun 20, 2025.',
    ],
    [
      'CLS-MARKET-VALUE: a receipt without a stored price',
      'Income',
      unpriced,
      'Value at the time',
      'No price is stored for BTC around Jun 20, 2025, so the coins are valued at its latest stored price (Oct 4, 2026). Change it if they were worth something else.',
    ],
  ] as const)(
    '%s answered as %s says what its value means',
    async (_name, type, row, label, hint) => {
      const { user } = renderForm(row);
      await user.click(screen.getByRole('button', { name: type }));
      expect(hintOf(label)).toBe(hint);
    },
  );

  it('CLS-SWAP: the other side of a swap says where it may come from', async () => {
    const { user } = renderForm();
    await user.click(screen.getByRole('button', { name: 'Swap' }));
    expect(hintOf('Paid with')).toBe(
      'Transactions in another coin within a week from any of your wallets, or what you added by hand or from CSV for this wallet.',
    );
  });

  it('CLS-BUY: a stablecoin counts 1:1 with USD', async () => {
    const { user } = renderForm();
    await user.click(screen.getByRole('button', { name: 'Buy' }));
    expect(screen.getByText('USDT is counted 1:1 with USD.')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'USD' }));
    expect(screen.queryByText(/is counted 1:1 with USD/)).toBeNull();
  });
});
