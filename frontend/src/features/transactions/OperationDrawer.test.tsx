import { assetRewardsApi, type RewardReceipt } from '@api/asset-rewards.api';
import apiClient from '@api/client';
import { type Operation, operationsApi } from '@api/operations.api';
import { type JournalState, tradesApi } from '@api/trades.api';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POOL_DEPOSIT_NAMED } from './ClassifyForm';
import OperationDrawer from './OperationDrawer';

// Characterization of the drawer's facts, rendered as the owner sees them. Synthetic data only.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const btc = { instrumentId: null, symbol: 'BTC', name: 'Bitcoin' };
const usdt = { instrumentId: id(2), symbol: 'USDT', name: 'Tether' };
const bybit = { id: id(10), name: 'Bybit' };
const cold = { id: id(11), name: 'Cold storage' };
const bitcoinWallet = {
  id: id(20),
  network: 'bitcoin' as const,
  address: 'bc1qsyntheticwalletaddress000000000f3t4',
  label: null,
};
const bybitWallet = { id: id(21), network: 'bybit' as const, address: '100000001', label: 'Main' };
const txid = (n: number) => String(n).padStart(64, 'a');

const operation = (changes: Partial<Operation> & Pick<Operation, 'id'>): Operation => {
  const recorded: Operation = {
    kind: 'chain',
    type: 'buy',
    direction: 'in',
    occurredAt: '2025-06-13T08:00:00.000Z',
    orderWithinTimestamp: 0,
    asset: btc,
    quantity: '0.01',
    counterAsset: null,
    counterQuantity: null,
    valueUsd: null,
    estimatedValueUsd: null,
    costBasisUsd: null,
    feeUsd: null,
    fee: null,
    paid: null,
    settlement: null,
    comment: null,
    classification: null,
    account: bybit,
    counterAccount: null,
    wallet: bitcoinWallet,
    counterWallet: null,
    chain: { txid: txid(1), blockHeight: 800001, priceObservedAt: null, direction: 'in' },
    status: 'recorded',
    source: 'chain',
    version: null,
    value: null,
    estimatedValue: null,
    costBasis: null,
    feeValue: null,
    ...changes,
  };
  // In USD the list's quote-currency amounts are the recorded USD amounts.
  return {
    ...recorded,
    value: recorded.valueUsd,
    estimatedValue: recorded.estimatedValueUsd,
    costBasis: recorded.costBasisUsd,
    feeValue: recorded.feeUsd,
  };
};
const classification = (comment: string | null) => ({
  version: 1,
  hidden: false,
  value: null,
  comment,
  automatic: false,
});

function renderDrawer(subject: Operation) {
  render(
    <MemoryRouter>
      <OperationDrawer operation={subject} onClose={() => undefined} />
    </MemoryRouter>,
  );
}

/** Every fact of the drawer as [term, text], in order. */
function details(): [string, string][] {
  const region = screen.getByRole('region', { name: 'Details' });
  return Array.from(region.querySelectorAll('dt')).map((term) => [
    term.textContent ?? '',
    term.nextElementSibling?.textContent ?? '',
  ]);
}

const httpError = (status: number, data: object = {}) =>
  new AxiosError('refused', String(status), undefined, undefined, {
    status,
    statusText: 'Refused',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data,
  });
const dependent = {
  operationId: `trade:${id(50)}`,
  accountId: bybit.id,
  instrumentId: id(1),
  occurredAt: '2025-07-01T00:00:00.000Z',
};

// Without a network the portfolio read fails, so the title shows plain tickers.
const networkAdapter = apiClient.defaults.adapter;
beforeAll(() => {
  apiClient.defaults.adapter = (config) =>
    Promise.reject(new AxiosError('No network in tests', 'ERR_NETWORK', config));
});
afterAll(() => {
  apiClient.defaults.adapter = networkAdapter;
});
afterEach(cleanup);

describe('OperationDrawer facts', () => {
  it('M9: a Bybit buy names its price, what it paid, the cash it spent and its comment', () => {
    renderDrawer(
      operation({
        id: `chain:${bybitWallet.id}:bybit-trade-2100000000000000001`,
        wallet: bybitWallet,
        chain: {
          txid: 'bybit-trade-2100000000000000001',
          blockHeight: 0,
          priceObservedAt: null,
          direction: 'in',
        },
        valueUsd: '1000',
        costBasisUsd: '1000',
        paid: {
          currency: 'RUB',
          gross: '90000',
          fee: '0',
          rateDate: '2025-06-13',
          perUsd: '90',
          rateSource: 'owner',
        },
        settlement: { asset: usdt, quantity: '1000' },
        fee: { asset: usdt, quantity: '1', valueUsd: '1', value: '1' },
        classification: classification('Synthetic note'),
      }),
    );
    expect(details()).toEqual([
      ['Date', 'Jun 13, 2025, 08:00 UTC'],
      ['Network', 'Bybit'],
      ['Wallet', 'Bybit'],
      ['Account', 'Main · UID 100000001'],
      ['Bybit record', 'Trade 2100000000000000001'],
      ['Fee', '1 USDT · ≈ $1.00'],
      ['Estimated value', 'No stored price for that time'],
      ['Value', '$1,000.00'],
      ['Price', '$100,000.00 per BTC'],
      ['Paid', '90,000 RUB at 90 RUB per USD'],
      ['Paid from cash', '1,000 USDT'],
      ['Cost basis', '$1,000.00'],
      ['Comment', 'Synthetic note'],
      ['Status', 'Recorded'],
      ['Source', 'Bybit'],
    ]);
  });

  it('M9: a sale on a blockchain keeps its cash and names the other address, without a price', () => {
    renderDrawer(
      operation({
        id: `chain:${bitcoinWallet.id}:${txid(2)}`,
        type: 'sell',
        direction: 'out',
        chain: { txid: txid(2), blockHeight: 800002, priceObservedAt: null, direction: 'out' },
        counterWallet: {
          id: id(22),
          network: 'bitcoin',
          address: 'bc1qsyntheticotheraddress0000000000a1b2',
          label: 'Savings',
        },
        valueUsd: '500',
        settlement: { asset: usdt, quantity: '500' },
        classification: classification(null),
      }),
    );
    expect(details()).toEqual([
      ['Date', 'Jun 13, 2025, 08:00 UTC'],
      ['Network', 'Bitcoin'],
      ['Wallet', 'Bybit'],
      ['Address', 'bc1qsy…f3t4'],
      ['Your other address', 'Savings · bc1qsy…a1b2'],
      ['Transaction', 'aaaaaa…aaa2View in explorer'],
      ['Block', '800,002'],
      ['Network fee', 'Paid by sender'],
      ['Estimated value', 'No stored price for that time'],
      ['Value', '$500.00'],
      ['Kept as cash', '+500 USDT'],
      ['Comment', 'None'],
      ['Status', 'Recorded'],
      ['Source', 'Blockchain'],
    ]);
  });

  it('BYBIT-CHAIN-FACTS: a Bybit withdrawal names the address it went to and the chain hash', () => {
    renderDrawer(
      operation({
        id: `chain:${bybitWallet.id}:bybit-withdrawal-onchain-3000000001`,
        type: 'withdrawal',
        direction: 'out',
        wallet: bybitWallet,
        chain: {
          txid: 'bybit-withdrawal-onchain-3000000001',
          blockHeight: 0,
          priceObservedAt: null,
          direction: 'out',
          exchange: {
            kind: 'withdrawal',
            chain: 'ETH',
            network: 'ethereum',
            address: '0x00000000000000000000000000000000000000a1',
            fromAddress: null,
            hash: 'b1'.padEnd(64, '0'),
          },
        },
      }),
    );
    expect(details()).toEqual([
      ['Date', 'Jun 13, 2025, 08:00 UTC'],
      ['Network', 'Bybit'],
      ['Blockchain', 'Ethereum'],
      ['Wallet', 'Bybit'],
      ['Account', 'Main · UID 100000001'],
      ['Withdrawal address', '0x000…00a1'],
      ['Transaction', '0xb10…0000View in explorer'],
      ['Fee', 'None'],
      ['Estimated value', 'No stored price for that time'],
      ['Value', 'Not recorded'],
      ['Status', 'Recorded'],
      ['Source', 'Bybit'],
    ]);
  });

  it('BYBIT-CHAIN-FACTS: a Bybit deposit names the address that sent it', () => {
    renderDrawer(
      operation({
        id: `chain:${bybitWallet.id}:bybit-deposit-onchain-3000000002`,
        type: 'deposit',
        wallet: bybitWallet,
        chain: {
          txid: 'bybit-deposit-onchain-3000000002',
          blockHeight: 0,
          priceObservedAt: null,
          direction: 'in',
          exchange: {
            kind: 'deposit',
            chain: 'TRX',
            network: null,
            address: null,
            fromAddress: 'TSyntheticSendingAddress00000000001',
            hash: null,
          },
        },
      }),
    );
    expect(details()).toEqual([
      ['Date', 'Jun 13, 2025, 08:00 UTC'],
      ['Network', 'Bybit'],
      ['Blockchain', 'TRX'],
      ['Wallet', 'Bybit'],
      ['Account', 'Main · UID 100000001'],
      ['Sending address', 'TSynth…0001'],
      ['Bybit record', 'Deposit 3000000002'],
      ['Fee', 'None'],
      ['Estimated value', 'No stored price for that time'],
      ['Value', 'Not recorded'],
      ['Status', 'Recorded'],
      ['Source', 'Bybit'],
    ]);
  });

  it('CLS-SWAP: a blockchain swap keeps its comment', () => {
    renderDrawer(
      operation({
        id: `chain:${bitcoinWallet.id}:${txid(3)}`,
        type: 'swap',
        counterAsset: usdt,
        counterQuantity: '600',
        chain: { txid: txid(3), blockHeight: 800003, priceObservedAt: null, direction: 'in' },
        classification: classification('Synthetic swap note'),
      }),
    );
    expect(details()).toEqual([
      ['Date', 'Jun 13, 2025, 08:00 UTC'],
      ['Paid', '-0.01 BTC'],
      ['Paid from', 'Bybit'],
      ['Received', '+600 USDT'],
      ['Received in', 'Bybit'],
      ['Address', 'Bitcoin · bc1qsy…f3t4'],
      ['Transaction', 'aaaaaa…aaa3View in explorer'],
      ['Block', '800,003'],
      ['Network fee', 'Paid by sender'],
      ['Value', 'Not recorded'],
      ['Cost basis', 'Unknown'],
      ['Comment', 'Synthetic swap note'],
      ['Status', 'Recorded'],
      ['Source', 'Blockchain'],
    ]);
  });

  it('a journal swap names what it received, its cost basis and its fee in coins', () => {
    renderDrawer(
      operation({
        id: `swap:${id(40)}`,
        kind: 'swap',
        type: 'swap',
        source: 'manual',
        wallet: null,
        chain: null,
        version: 1,
        counterAsset: usdt,
        counterQuantity: '600',
        valueUsd: '600',
        costBasisUsd: '550',
        fee: { asset: usdt, quantity: '0.5' },
      }),
    );
    expect(details()).toEqual([
      ['Date', 'Jun 13, 2025, 08:00 UTC'],
      ['Account', 'Bybit'],
      ['Received', '+600 USDT'],
      ['Value', '$600.00'],
      ['Cost basis', '$550.00'],
      ['Fee', '0.5 USDT'],
      ['Status', 'Recorded'],
      ['Source', 'Added by you'],
    ]);
  });

  it('a journal transfer names both accounts and a fee worth something', () => {
    renderDrawer(
      operation({
        id: `transfer:${id(41)}`,
        kind: 'transfer',
        type: 'transfer',
        direction: 'internal',
        source: 'manual',
        wallet: null,
        chain: null,
        version: 1,
        counterAccount: cold,
        feeUsd: '2.5',
        fee: { asset: btc, quantity: '0.00003' },
      }),
    );
    expect(details()).toEqual([
      ['Date', 'Jun 13, 2025, 08:00 UTC'],
      ['From', 'Bybit'],
      ['To', 'Cold storage'],
      ['Value', 'Not recorded'],
      ['Fee', '$2.50'],
      ['Status', 'Recorded'],
      ['Source', 'Added by you'],
    ]);
  });
});

describe('OperationDrawer notes', () => {
  /** The verdicts on the transaction (role note), in order. */
  const notes = () => screen.queryAllByRole('note').map((note) => note.textContent);
  const automatic = {
    version: 1,
    hidden: false,
    value: null,
    comment: null,
    automatic: true,
  };
  const ethWallet = { ...bitcoinWallet, id: id(23), network: 'ethereum' as const };
  const withdrawal = (pool: Operation['pool']) =>
    operation({
      id: `chain:${ethWallet.id}:${txid(5)}`,
      type: 'pool-withdrawal',
      wallet: ethWallet,
      asset: usdt,
      quantity: '1000',
      pool,
    });

  it('SOL-STAKE-MOVE, ETH-STAKE-MOVE: a stake move says where the coins went and back', () => {
    renderDrawer(operation({ id: `chain:${id(24)}:${txid(6)}`, type: 'stake' }));
    renderDrawer(
      operation({ id: `chain:${ethWallet.id}:${txid(7)}`, type: 'unstake', wallet: ethWallet }),
    );
    expect(notes()).toEqual([
      'Moved into a stake account of this wallet: the coins stay yours and keep their purchase price. Only the network fee is a cost.',
      'Returned from a staking pool of this wallet: not income and not a deposit, rewards count as they are earned. Only the network fee is a cost.',
    ]);
  });

  it('POOL-PARTIAL: a part of a deposit names what is left and the loss below it', () => {
    renderDrawer(
      withdrawal({ deposited: '1000', difference: '-0.5', partial: true, remaining: '0' }),
    );
    renderDrawer(
      withdrawal({ deposited: '1000', difference: '400', partial: true, remaining: '250' }),
    );
    renderDrawer(withdrawal({ deposited: '1000', difference: '0' }));
    expect(notes()).toEqual([
      'Returned from a liquidity pool: a part of the deposit comes back as your own coins, not income and not a deposit. Nothing is left in the pool. The 0.5 USDT below it left without a sale price (impermanent loss).',
      'Returned from a liquidity pool: a part of the deposit comes back as your own coins, not income and not a deposit. The 250 USDT left in the pool stay yours, with their purchase price. The 400 USDT above it is pool income.',
      'Returned from a liquidity pool: the deposit comes back as your own coins, not income and not a deposit.',
    ]);
  });

  it('BYBIT-CONVERT, BYBIT-TRADES: an automatic sale names the history it came from', () => {
    renderDrawer(
      operation({
        id: `chain:${bybitWallet.id}:bybit-trade-convert-4000000001`,
        type: 'sell',
        wallet: bybitWallet,
        chain: {
          txid: 'bybit-trade-convert-4000000001',
          blockHeight: 0,
          priceObservedAt: null,
          direction: 'out',
        },
        classification: automatic,
      }),
    );
    expect(notes()).toEqual([
      "Recognised automatically from Bybit's convert history: the coins sold were already in this account, so it counts as a sale, not a deposit. Change the classification if it is wrong.",
    ]);
  });

  it('CLS-PAID: coins that paid for a purchase in an account without a name say that account', () => {
    const bought = operation({
      id: `trade:${id(44)}`,
      kind: 'trade',
      source: 'manual',
      wallet: null,
      chain: null,
      account: null,
    });
    render(
      <MemoryRouter>
        <OperationDrawer
          operation={operation({
            id: `chain:${bitcoinWallet.id}:${txid(8)}`,
            type: 'transfer',
            classification: {
              ...automatic,
              automatic: false,
              value: { type: 'recorded', operation: { kind: 'trade', id: id(44) } },
            },
          })}
          operations={[bought]}
          onClose={() => undefined}
        />
      </MemoryRouter>,
    );
    expect(notes()).toEqual([
      'These coins moved to that account and paid for the purchase you added there, so the purchase is not new money. Change the classification if it is wrong.',
    ]);
  });
});

describe('OperationDrawer commands', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(tradesApi, 'state').mockResolvedValue({
      accountId: bybit.id,
      eligible: false,
      ineligibilityReason: 'already-initialized',
      journal: { journalRevision: 5 } as JournalState['journal'],
    });
    vi.spyOn(tradesApi, 'versions').mockImplementation(async (_account, tradeId) => ({
      tradeId,
      items: [],
      nextBeforeVersion: null,
    }));
    vi.spyOn(tradesApi, 'voidCheck').mockImplementation(async (_account, tradeId) => ({
      tradeId,
      dependent: null,
    }));
  });

  const journal = (changes: Partial<Operation> & Pick<Operation, 'id' | 'kind'>) =>
    operation({ source: 'manual', wallet: null, chain: null, version: 1, ...changes });
  const renderWith = (subject: Operation) => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    render(
      <MemoryRouter>
        <OperationDrawer operation={subject} onClose={() => undefined} onDeleted={onDeleted} />
      </MemoryRouter>,
    );
    return { user, onDeleted };
  };
  const confirmDelete = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete this transaction?' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete transaction' }));
    return confirm;
  };

  it('OPS-DELETE: a reward is voided with its own command at the revision read first', async () => {
    const voidReward = vi.spyOn(assetRewardsApi, 'void').mockResolvedValue({} as RewardReceipt);
    const { user, onDeleted } = renderWith(
      journal({ id: `reward:${id(42)}`, kind: 'reward', type: 'reward', version: 3 }),
    );
    await confirmDelete(user);
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(voidReward).toHaveBeenCalledWith(bybit.id, id(42), {
      requestId: expect.any(String),
      expectedJournalRevision: 5,
      expectedVersion: 3,
    });
  });

  it.each([
    [
      'no answer',
      new AxiosError('offline'),
      'Could not reach the server. The transaction may have been deleted; reload the page to check.',
    ],
    [
      'a conflict',
      httpError(409),
      'This transaction was changed elsewhere. Close this window, reload and try again.',
    ],
    ['a server error', httpError(500), 'Could not delete the transaction. Try again.'],
  ])('OPS-DELETE: a failed deletion after %s says so', async (_case, error, text) => {
    vi.spyOn(tradesApi, 'void').mockRejectedValue(error);
    const { user, onDeleted } = renderWith(journal({ id: `trade:${id(43)}`, kind: 'trade' }));
    const confirm = await confirmDelete(user);
    expect(await within(confirm).findByText(text)).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a later transaction spends the coins',
      httpError(409, { message: 'refused', dependent }),
      'A later transaction spends these coins, so this one cannot be hidden. Change that transaction first.',
    ],
    [
      'a pool withdrawal names the deposit',
      httpError(422, { message: POOL_DEPOSIT_NAMED }),
      'A pool withdrawal returns this deposit, so it cannot be hidden. Change that withdrawal first.',
    ],
    [
      'no answer',
      new AxiosError('offline'),
      'Could not reach the server. It may have been saved; reload the page to check.',
    ],
    [
      'a conflict',
      httpError(409),
      'This transaction was changed elsewhere. Close this window, reload and try again.',
    ],
    ['another refusal', httpError(422, { message: 'refused' }), 'Could not save. Try again.'],
  ])('CLS-HIDE: hiding refused when %s says so', async (_case, error, text) => {
    vi.spyOn(operationsApi, 'classify').mockRejectedValue(error);
    const { user } = renderWith(
      operation({ id: `chain:${bitcoinWallet.id}:${txid(4)}`, type: 'deposit' }),
    );
    await user.click(screen.getByRole('button', { name: 'Hide from calculations' }));
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide from calculations' })).toBeEnabled();
  });
});
