import apiClient from '@api/client';
import type { Operation } from '@api/operations.api';
import { cleanup, render, screen } from '@testing-library/react';
import { AxiosError } from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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
