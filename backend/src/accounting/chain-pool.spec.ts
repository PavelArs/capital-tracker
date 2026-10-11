import { UnprocessableEntityException } from '@nestjs/common';
import {
  byPoolOrder,
  type PoolLeg,
  planPoolWithdrawal,
  poolAtomsToUnits,
  poolDepositUnits,
  poolGainValueUsd,
  poolMoveUnits,
  poolReturnUnits,
  settlePool,
  storedValueUsd,
} from './chain-pool';

// Synthetic ids and amounts only (liquidity-pool-chain-legs, POOL-*).
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const txid = (n: number) => String(n).padStart(64, 'd');
const [ethAddress, coldAddress, trust, cold] = [id(1), id(2), id(10), id(11)];

// POOL-DEPOSIT: 1 ETH with a 0.001 ETH network fee and 3000 USDC go into a pool at 10:00.
const ethDeposit: PoolLeg = {
  addressId: ethAddress,
  txid: txid(1),
  accountId: trust,
  network: 'ethereum',
  asset: null,
  blockTime: '2026-08-10T10:00:00.000Z',
  receivedUnits: '0',
  sentUnits: '1001000000000000000',
  feeUnits: '1000000000000000',
};
const usdcDeposit: PoolLeg = {
  ...ethDeposit,
  txid: `${txid(1)}-4`,
  asset: 'USDC',
  sentUnits: '3000000000',
  feeUnits: '0',
};
// POOL-WITHDRAW: the pool returns 0.9 ETH, the owner paying a 0.0005 ETH fee, and 3400 USDC.
const ethWithdrawal: PoolLeg = {
  ...ethDeposit,
  txid: txid(2),
  blockTime: '2026-09-01T10:00:00.000Z',
  receivedUnits: '900000000000000000',
  sentUnits: '500000000000000',
  feeUnits: '500000000000000',
};
const usdcWithdrawal: PoolLeg = {
  ...ethWithdrawal,
  txid: `${txid(2)}-3`,
  asset: 'USDC',
  receivedUnits: '3400000000',
  sentUnits: '0',
  feeUnits: '0',
};

const unprocessable = (action: () => unknown, message: string) => {
  expect(action).toThrow(UnprocessableEntityException);
  expect(action).toThrow(message);
};

describe('liquidity-pool-chain-legs', () => {
  it('POOL-DEPOSIT: what went into the pool leaves the network fee apart', () => {
    expect(poolDepositUnits(ethDeposit)).toBe(1000000000000000000n);
    expect(poolDepositUnits(usdcDeposit)).toBe(3000000000n);
    // Only the fee leaves the holdings.
    expect(poolMoveUnits(ethDeposit)).toBe(-1000000000000000n);
    expect(poolMoveUnits(usdcDeposit)).toBe(0n);
    // A leg that only paid its fee put nothing in.
    expect(poolDepositUnits({ ...ethDeposit, sentUnits: ethDeposit.feeUnits })).toBe(0n);
  });

  it('POOL-WITHDRAW: 400 USDC above the deposit are a gain, nothing leaves', () => {
    expect(planPoolWithdrawal(usdcWithdrawal, usdcDeposit)).toEqual({
      accountId: trust,
      occurredAt: '2026-09-01T10:00:00.000Z',
      deposited: '3000',
      returned: '3400',
      gain: '400',
      loss: '0',
      partial: false,
      remaining: '0',
    });
    expect(poolMoveUnits(usdcWithdrawal)).toBe(0n);
  });

  it('POOL-WITHDRAW: 0.1 ETH below the deposit leave with the withdrawal fee', () => {
    expect(poolReturnUnits(ethWithdrawal)).toBe(900000000000000000n);
    expect(planPoolWithdrawal(ethWithdrawal, ethDeposit)).toMatchObject({
      deposited: '1',
      returned: '0.9',
      gain: '0',
      loss: '0.1',
    });
    expect(
      poolMoveUnits(
        ethWithdrawal,
        poolAtomsToUnits(100000000000000000n * 10n ** 12n, ethWithdrawal),
      ),
    ).toBe(-100500000000000000n);
  });

  it('POOL-WITHDRAW: the gain is worth what the owner says, 1:1 for stablecoins, else the stored price', () => {
    expect(poolGainValueUsd('410', 'USDC', '400', null)).toBe('410');
    expect(poolGainValueUsd(null, 'USDC', '400', null)).toBe('400');
    expect(poolGainValueUsd(null, 'ETH', '0.1', '3000')).toBe('300');
    expect(poolGainValueUsd(null, 'ETH', '0.123456', '3000.5')).toBe('370.43');
    expect(poolGainValueUsd(null, 'ETH', '0.1', null)).toBeNull();
  });

  it('FEE-VALUE: a quantity without a value is worth 1:1 in stablecoins, else its stored price', () => {
    expect(storedValueUsd('USDT', '1.5', null)).toBe('1.5');
    expect(storedValueUsd('ETH', '0.000603', '3000')).toBe('1.81');
    expect(storedValueUsd('ETH', '0.000603', null)).toBeNull();
  });

  it('POOL-INVALID: a withdrawal returns an earlier deposit of its coin in the same wallet', () => {
    unprocessable(
      () => planPoolWithdrawal(ethWithdrawal, usdcDeposit),
      'A pool withdrawal returns the coin of its deposit',
    );
    unprocessable(
      () =>
        planPoolWithdrawal(usdcWithdrawal, {
          ...usdcDeposit,
          blockTime: '2026-09-02T10:00:00.000Z',
        }),
      'Choose a pool deposit made before this withdrawal',
    );
    unprocessable(
      () =>
        planPoolWithdrawal(usdcWithdrawal, {
          ...usdcDeposit,
          addressId: coldAddress,
          accountId: cold,
        }),
      'Choose a pool deposit of this wallet',
    );
    unprocessable(
      () => planPoolWithdrawal({ ...usdcWithdrawal, accountId: null }, usdcDeposit),
      'Choose the account of this wallet first',
    );
    unprocessable(
      () => planPoolWithdrawal(usdcWithdrawal, usdcWithdrawal),
      'Choose a pool deposit',
    );
    unprocessable(
      () => planPoolWithdrawal(usdcWithdrawal, { ...usdcDeposit, sentUnits: '0' }),
      'Choose a pool deposit',
    );
    unprocessable(
      () => planPoolWithdrawal({ ...usdcWithdrawal, network: 'bybit' }, usdcDeposit),
      'This type does not fit the direction of the transaction',
    );
  });

  // POOL-PARTIAL: 1 ETH went in; the pool pays it back in parts, the network fee of each part
  // paid by the owner.
  const part = (n: number, hour: string, received: string): PoolLeg => ({
    ...ethWithdrawal,
    txid: txid(20 + n),
    blockTime: `2026-09-0${n}T${hour}:00:00.000Z`,
    receivedUnits: received,
    sentUnits: '0',
    feeUnits: '0',
  });
  const first = part(1, '10', '400000000000000000');
  const second = part(2, '10', '350000000000000000');

  it('POOL-PARTIAL: a part returns its share of the deposit without a loss and leaves the rest in the pool', () => {
    expect(planPoolWithdrawal(first, ethDeposit, { partial: true })).toMatchObject({
      deposited: '1',
      returned: '0.4',
      gain: '0',
      loss: '0',
      partial: true,
      remaining: '0.6',
    });
    // The part that closes the deposit takes what the earlier parts left: 0.25 ETH below it.
    expect(
      planPoolWithdrawal(second, ethDeposit, {
        earlier: [{ leg: first, partial: true }],
      }),
    ).toMatchObject({ returned: '0.35', gain: '0', loss: '0.25', partial: false, remaining: '0' });
    // A part that is not the last also loses nothing.
    expect(
      planPoolWithdrawal(second, ethDeposit, {
        partial: true,
        earlier: [{ leg: first, partial: true }],
      }),
    ).toMatchObject({ loss: '0', remaining: '0.25' });
  });

  it('POOL-PARTIAL: what comes back beyond what was left is pool income', () => {
    const third = part(3, '10', '700000000000000000');
    expect(
      planPoolWithdrawal(third, ethDeposit, {
        earlier: [
          { leg: first, partial: true },
          { leg: second, partial: true },
        ],
      }),
    ).toMatchObject({ returned: '0.7', gain: '0.45', loss: '0', remaining: '0' });
    // The parts together may pass the deposit before the last one: the excess is income.
    expect(
      planPoolWithdrawal(part(2, '10', '800000000000000000'), ethDeposit, {
        partial: true,
        earlier: [{ leg: first, partial: true }],
      }),
    ).toMatchObject({ gain: '0.2', loss: '0', remaining: '0' });
  });

  it('POOL-PARTIAL: each withdrawal is settled against what the earlier ones left', () => {
    expect(
      settlePool(1000n, [
        { returnedAtoms: 400n, partial: true },
        { returnedAtoms: 700n, partial: true },
        { returnedAtoms: 50n, partial: false },
      ]),
    ).toEqual([
      { principal: 400n, gain: 0n, loss: 0n, remaining: 600n },
      { principal: 600n, gain: 100n, loss: 0n, remaining: 0n },
      { principal: 0n, gain: 50n, loss: 0n, remaining: 0n },
    ]);
  });

  it('POOL-PARTIAL: only the withdrawal that closes a deposit takes its shortfall', () => {
    expect(poolMoveUnits(first)).toBe(0n);
    expect(poolMoveUnits(second, 250000000000000000n)).toBe(-250000000000000000n);
  });

  it('POOL-INVALID: a deposit returned in full takes no further withdrawal', () => {
    unprocessable(
      () =>
        planPoolWithdrawal(part(3, '10', '100000000000000000'), ethDeposit, {
          earlier: [{ leg: part(2, '10', '1000000000000000000'), partial: true }],
        }),
      'That pool deposit was already returned in full',
    );
  });

  it('POOL-INVALID: the parts of one deposit come back on its own network', () => {
    unprocessable(
      () =>
        planPoolWithdrawal(
          { ...first, network: 'solana' },
          { ...ethDeposit, network: 'ethereum' },
          {
            partial: true,
          },
        ),
      'A pool withdrawal returns the coin of its deposit',
    );
    unprocessable(
      () =>
        planPoolWithdrawal({ ...usdcWithdrawal, network: 'tron' }, usdcDeposit, { partial: true }),
      'Withdrawals of one deposit come back on the network of the deposit',
    );
  });

  it('POOL-PARTIAL: parts are ordered by time, then by transaction id', () => {
    const at = (blockTime: string, id: string) => ({ blockTime, txid: id });
    expect(
      byPoolOrder(at('2026-09-01T10:00:00.000Z', 'b'), at('2026-09-02T10:00:00.000Z', 'a')),
    ).toBeLessThan(0);
    expect(
      byPoolOrder(at('2026-09-01T10:00:00.000Z', 'a'), at('2026-09-01T10:00:00.000Z', 'b')),
    ).toBeLessThan(0);
    expect(
      byPoolOrder(at('2026-09-01T10:00:00.000Z', 'a'), at('2026-09-01T10:00:00.000Z', 'a')),
    ).toBe(0);
  });
});
