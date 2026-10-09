import { UnprocessableEntityException } from '@nestjs/common';
import { planSwap, type SwapSide, swapValueUsd } from './chain-swap';

// Synthetic ids and amounts only (swap-chain-coins, CLS-SWAP-*).
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const txid = (n: number) => String(n).padStart(64, 'c');
const [ethAddress, btcAddress, trust, cold] = [id(1), id(2), id(10), id(11)];

// CLS-SWAP-SAME: 1000 USDT leave the Ethereum address of Trust Wallet at 10:00 and 0.0125 BTC
// arrive at its Bitcoin address at 10:40.
const usdtOut: SwapSide = {
  addressId: ethAddress,
  txid: `${txid(1)}-4`,
  accountId: trust,
  network: 'ethereum',
  asset: 'USDT',
  blockTime: '2026-09-01T10:00:00.000Z',
  receivedUnits: '0',
  sentUnits: '1000000000',
  feeUnits: '0',
};
const btcIn: SwapSide = {
  addressId: btcAddress,
  txid: txid(2),
  accountId: trust,
  network: 'bitcoin',
  asset: null,
  blockTime: '2026-09-01T10:40:00.000Z',
  receivedUnits: '1250000',
  sentUnits: '0',
  feeUnits: '1400',
};
// 0.5 ETH and a 0.002 ETH network fee leave the Ethereum address.
const ethOut: SwapSide = {
  ...usdtOut,
  txid: txid(3),
  asset: null,
  sentUnits: '502000000000000000',
  feeUnits: '2000000000000000',
};

const unprocessable = (action: () => unknown, message: string) => {
  expect(action).toThrow(UnprocessableEntityException);
  expect(action).toThrow(message);
};

describe('swap-chain-coins plan', () => {
  it('CLS-SWAP-SAME: one wallet pays 1000 USDT for 0.0125 BTC, recorded when the BTC arrived', () => {
    const plan = planSwap(btcIn, usdtOut);
    expect(plan).toEqual({
      accountId: trust,
      occurredAt: '2026-09-01T10:40:00.000Z',
      paying: usdtOut,
      receiving: btcIn,
      paid: '1000',
      received: '0.0125',
      feeQuantity: '0',
      carry: null,
    });
    // Either side names the same swap.
    expect(planSwap(usdtOut, btcIn)).toEqual(plan);
  });

  it('CLS-SWAP-SAME: a paying leg in the network coin keeps its fee apart from what it paid', () => {
    const plan = planSwap(btcIn, ethOut);
    expect([plan.paid, plan.feeQuantity, plan.carry]).toEqual(['0.5', '0.002', null]);
  });

  it('CLS-SWAP-CROSS: paid from another wallet, the coins move there first with the fee', () => {
    const plan = planSwap({ ...btcIn, accountId: cold }, ethOut);
    expect(plan.accountId).toBe(cold);
    expect(plan.occurredAt).toBe(btcIn.blockTime);
    expect([plan.paid, plan.received, plan.feeQuantity]).toEqual(['0.5', '0.0125', '0']);
    expect(plan.carry).toEqual({
      fromAccountId: trust,
      toAccountId: cold,
      occurredAt: ethOut.blockTime,
      quantity: '0.5',
      feeQuantity: '0.002',
    });
    // Coins that arrived before they were paid for move at the arrival, so the swap finds them.
    const early = planSwap(
      { ...btcIn, accountId: cold, blockTime: '2026-09-01T09:00:00.000Z' },
      ethOut,
    );
    expect(early.carry?.occurredAt).toBe('2026-09-01T09:00:00.000Z');
    expect(early.occurredAt).toBe('2026-09-01T09:00:00.000Z');
  });

  it('CLS-SWAP-INVALID: names what does not fit', () => {
    unprocessable(() => planSwap(btcIn, btcIn), 'Choose the other side of the swap');
    unprocessable(
      () => planSwap(btcIn, { ...btcIn, addressId: id(3), txid: txid(4) }),
      'Choose a transaction that moved coins the other way',
    );
    unprocessable(
      () =>
        planSwap(usdtOut, {
          ...usdtOut,
          network: 'solana',
          txid: txid(5),
          receivedUnits: '1000000000',
          sentUnits: '0',
        }),
      'A swap needs two different coins',
    );
    unprocessable(
      () => planSwap({ ...btcIn, accountId: null }, usdtOut),
      'Choose the account of this wallet first',
    );
    unprocessable(
      () => planSwap(btcIn, { ...usdtOut, accountId: null }),
      'Choose the account of the other wallet first',
    );
    // Only the fee left: nothing was paid.
    unprocessable(
      () => planSwap(btcIn, { ...ethOut, sentUnits: ethOut.feeUnits }),
      'This type does not fit the direction of the transaction',
    );
  });
});

describe('swap-chain-coins value', () => {
  const same = () => planSwap(btcIn, usdtOut);
  const eth = () => planSwap(btcIn, ethOut);

  it('CLS-SWAP-VALUE: the value the owner entered wins', () => {
    expect(swapValueUsd('1012.5', same(), null)).toBe('1012.5');
    expect(swapValueUsd('1700', eth(), '3000')).toBe('1700');
  });

  it('CLS-SWAP-VALUE: a stablecoin on either side counts 1:1', () => {
    expect(swapValueUsd(null, same(), null)).toBe('1000');
    const sold = planSwap(
      { ...usdtOut, receivedUnits: '1500000000', sentUnits: '0' },
      { ...btcIn, receivedUnits: '0', sentUnits: '2501400' },
    );
    expect(swapValueUsd(null, sold, '60000')).toBe('1500');
  });

  it('CLS-SWAP-VALUE: otherwise the stored price of the paid coin, in cents; unknown without one', () => {
    expect(swapValueUsd(null, eth(), '3456.789')).toBe('1728.39');
    expect(swapValueUsd(null, eth(), null)).toBeNull();
  });
});
