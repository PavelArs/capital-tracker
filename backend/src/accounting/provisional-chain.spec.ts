import type { PortfolioLot } from './portfolio-valuation';
import { applyChainMoves, type ChainMove } from './provisional-chain';

const BTC = '00000000-0000-4000-8000-000000000001';
const ETH = '00000000-0000-4000-8000-000000000002';
const lot = (quantity: string, costUsd: string | null, acquiredAt: string): PortfolioLot => ({
  instrumentId: BTC,
  quantity,
  costUsd,
  acquiredAt,
});
const move = (inbound: boolean, quantity: string, occurredAt: string): ChainMove => ({
  instrumentId: BTC,
  inbound,
  quantity,
  occurredAt,
});

describe('provisional chain movements (D1)', () => {
  it('CLS-PROVISIONAL: an unanswered receipt counts from its block time without a cost', () => {
    const receipt = move(true, '0.01', '2026-03-01T10:00:00.000Z');
    expect(applyChainMoves([], [receipt], '2026-03-01T09:59:59.999Z')).toEqual([]);
    expect(applyChainMoves([], [receipt], '2026-03-02T00:00:00.000Z')).toEqual([
      lot('0.01', null, '2026-03-01T10:00:00.000Z'),
    ]);
  });

  it('an unanswered payment takes the oldest coins held then, keeping the rest of their cost', () => {
    const lots = [
      lot('1', '60000', '2026-01-01T00:00:00.000Z'),
      {
        ...lot('0.5', '20000', '2025-12-01T00:00:00.000Z'),
        native: { currency: 'RUB' as const, amount: '1600000' },
      },
      lot('2', '1', '2026-04-01T00:00:00.000Z'),
      { ...lot('3', '3', '2025-01-01T00:00:00.000Z'), instrumentId: ETH },
    ];
    const after = applyChainMoves(lots, [move(false, '0.75', '2026-02-01T00:00:00.000Z')], 'z');
    expect(after).toEqual([
      lot('0.75', '45000', '2026-01-01T00:00:00.000Z'),
      lot('2', '1', '2026-04-01T00:00:00.000Z'),
      { ...lot('3', '3', '2025-01-01T00:00:00.000Z'), instrumentId: ETH },
    ]);
    // Part of a lot keeps its share of the cost and of the amount paid.
    expect(
      applyChainMoves(lots, [move(false, '0.25', '2026-02-01T00:00:00.000Z')], 'z')[1],
    ).toEqual({
      ...lot('0.25', '10000', '2025-12-01T00:00:00.000Z'),
      native: { currency: 'RUB', amount: '800000' },
    });
  });

  it('a payment larger than what was held takes only what there was; a later receipt stays', () => {
    const lots = [lot('0.1', '6000', '2026-01-01T00:00:00.000Z')];
    const moves = [
      move(true, '0.2', '2026-03-01T00:00:00.000Z'),
      move(false, '0.5', '2026-02-01T00:00:00.000Z'),
    ];
    expect(applyChainMoves(lots, moves, 'z')).toEqual([
      lot('0.2', null, '2026-03-01T00:00:00.000Z'),
    ]);
  });

  it('a receipt and a payment at the same instant count the receipt first', () => {
    const at = '2026-03-01T00:00:00.000Z';
    expect(applyChainMoves([], [move(false, '0.3', at), move(true, '1', at)], at)).toEqual([
      lot('0.7', null, at),
    ]);
  });

  describe('a payment whose coins a later sale by hand already spent', () => {
    // Buy 1 BTC (Jan), unanswered send of 1 BTC (Feb), buy 1 BTC (Mar), sale by hand of 1 BTC
    // (Apr). FIFO gives the sale the January coins, so only the March lot is left.
    const march = lot('1', '80000', '2026-03-01T00:00:00.000Z');
    const send = move(false, '1', '2026-02-01T00:00:00.000Z');
    const journal = (held: Record<string, string>) => (instrumentId: string, at: string) =>
      instrumentId === BTC ? BigInt(held[at] ?? '0') : 0n;
    const atoms = (units: string) => units + '0'.repeat(30);

    it('still leaves the wallet with nothing', () => {
      const held = journal({ '2026-02-01T00:00:00.000Z': atoms('1') });
      expect(applyChainMoves([march], [send], 'z', held)).toEqual([]);
    });

    it('takes no more than the wallet held at the payment', () => {
      const held = journal({ '2026-02-01T00:00:00.000Z': atoms('1') });
      const twice = move(false, '2', '2026-02-01T00:00:00.000Z');
      const later = lot('3', '90000', '2026-03-02T00:00:00.000Z');
      expect(applyChainMoves([march, later], [twice], 'z', held)).toEqual([later]);
    });

    it('takes what it owes from a later unanswered receipt as well', () => {
      // The March coins arrived on chain instead of being bought by hand.
      const held = journal({ '2026-02-01T00:00:00.000Z': atoms('1') });
      const receipt = move(true, '1', '2026-03-01T00:00:00.000Z');
      expect(applyChainMoves([], [send, receipt], 'z', held)).toEqual([]);
    });

    it('is valued as held between the payment and the sale', () => {
      const january = lot('1', '60000', '2026-01-01T00:00:00.000Z');
      // On 15 March the January and March lots are both still held: the send takes January's.
      expect(applyChainMoves([january, march], [send], '2026-03-15T00:00:00.000Z')).toEqual([
        march,
      ]);
    });
  });
});
