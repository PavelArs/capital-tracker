import type { Response } from 'express';
import { AssetRewardController } from './asset-reward.controller';
import type { AssetRewardService } from './asset-reward.service';
import { ChainClassificationService } from './chain-classification.service';
import { OwnedTransferController } from './owned-transfer.controller';
import type { OwnedTransferService } from './owned-transfer.service';
import { TradeController } from './trade.controller';
import type { TradeService } from './trade.service';

// BYBIT-P2P: every trade, transfer or reward the owner saves by hand gives waiting Bybit trades
// their chance at once (the real PostgreSQL probe bybit-db.cjs shows a P2P purchase paying one);
// a replayed request saves nothing and starts nothing. Ids are synthetic.

const OWNER = { userId: '00000000-0000-4000-8000-000000000001', email: 'owner@example.invalid' };
const ACCOUNT = '00000000-0000-4000-8000-000000000002';
const ITEM = '00000000-0000-4000-8000-000000000003';

function setup(created: boolean) {
  const calls: string[] = [];
  const write = (name: string) =>
    jest.fn(async () => {
      calls.push(name);
      return { created, value: { name } };
    });
  // The real afterManualWrite, with linking itself stubbed.
  const classifications = {
    afterManualWrite: ChainClassificationService.prototype.afterManualWrite,
    linkQuietly: jest.fn(async (owner: string) => {
      calls.push(`link ${owner}`);
    }),
  } as unknown as ChainClassificationService;
  const trades = {
    create: write('trade'),
    correct: write('trade correction'),
    void: write('trade void'),
  };
  const transfers = {
    create: write('transfer'),
    correct: write('transfer correction'),
    void: write('transfer void'),
  };
  const rewards = {
    create: write('reward'),
    correct: write('reward correction'),
    void: write('reward void'),
  };
  const response = { status: jest.fn() } as unknown as Response;
  const trade = new TradeController(
    trades as unknown as TradeService,
    null as never,
    classifications,
  );
  const transfer = new OwnedTransferController(
    transfers as unknown as OwnedTransferService,
    classifications,
  );
  const reward = new AssetRewardController(
    rewards as unknown as AssetRewardService,
    classifications,
  );
  const writes: [string, () => Promise<unknown>][] = [
    ['trade', () => trade.create(OWNER, ACCOUNT, {}, response)],
    ['trade correction', () => trade.correct(OWNER, ACCOUNT, ITEM, {}, response)],
    ['trade void', () => trade.voidTrade(OWNER, ACCOUNT, ITEM, {}, response)],
    ['transfer', () => transfer.create(OWNER, {}, response)],
    ['transfer correction', () => transfer.correct(OWNER, ITEM, {}, response)],
    ['transfer void', () => transfer.voidTransfer(OWNER, ITEM, {}, response)],
    ['reward', () => reward.create(OWNER, ACCOUNT, {}, response)],
    ['reward correction', () => reward.correct(OWNER, ACCOUNT, ITEM, {}, response)],
    ['reward void', () => reward.voidReward(OWNER, ACCOUNT, ITEM, {}, response)],
  ];
  return { calls, writes, response };
}

describe('BYBIT-P2P: waiting Bybit trades after a write by hand', () => {
  it.each(setup(true).writes.map(([name]) => [name]))(
    'BYBIT-P2P a saved %s is followed by linking and recognition for its owner',
    async (name) => {
      const { calls, writes, response } = setup(true);
      const [, run] = writes.find(([item]) => item === name)!;
      await expect(run()).resolves.toEqual({ name });
      expect(calls).toEqual([name, `link ${OWNER.userId}`]);
      expect(response.status).toHaveBeenCalledWith(201);
    },
  );

  it.each(setup(false).writes.map(([name]) => [name]))(
    'BYBIT-P2P a replayed %s saves nothing and starts nothing',
    async (name) => {
      const { calls, writes, response } = setup(false);
      const [, run] = writes.find(([item]) => item === name)!;
      await expect(run()).resolves.toEqual({ name });
      expect(calls).toEqual([name]);
      expect(response.status).toHaveBeenCalledWith(200);
    },
  );
});
