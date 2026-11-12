import { ConflictException, NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { CarryInService } from './carry-in.service';

const owner = '00000000-0000-4000-8000-000000000001';
const account = '00000000-0000-4000-8000-000000000002';
const ids = ['a', 'b', 'c', 'd', 'e'].map((n) => `00000000-0000-4000-8000-0000000000${n}1`);
const [a, b, c, d, e] = ids;
const asOf = new Date('2025-01-01T00:00:00.000Z');
const created = new Date('2025-01-02T00:00:00.000Z');
const conflict = new ConflictException('Carry-in request conflicts with saved state');

interface Position {
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  quantity: string;
  costStatus: 'known' | 'unknown';
  totalCostUsd: string | null;
}
interface World {
  revision: number | null;
  journal?: object;
  /** The opening revisions that have a saved snapshot. */
  snapshots?: number[];
  positions?: Position[];
  lots?: object[];
}

const position = (instrumentId: string, quantity: string, cost: string | null): Position => ({
  instrumentId,
  instrumentName: `Opening ${instrumentId.slice(-2)}`,
  instrumentSymbol: null,
  quantity,
  costStatus: 'known',
  totalCostUsd: cost,
});
const labels = ids.map((id) => ({ id, name: `Label ${id.slice(-2)}`, symbol: 'SYN' }));

function label(sql: string): string {
  const known: [string, string][] = [
    ['SET TRANSACTION READ ONLY', 'read only'],
    ['SELECT id,"currentRevision" FROM manual_accounts', 'read account'],
    ['SELECT * FROM account_trade_journals', 'read journal'],
    ['SELECT * FROM account_opening_snapshots', 'read snapshot'],
    ['FROM account_opening_positions', 'read positions'],
    ['FROM account_carry_in_lots', 'read lots'],
    ['SELECT id,name,symbol FROM accounting_instruments', 'read instruments'],
  ];
  const match = known.find(([text]) => sql.includes(text));
  if (!match) throw new Error(`Unexpected query: ${sql}`);
  return match[1];
}

function build(world: World) {
  const calls: [string, unknown[]][] = [];
  const snapshot = (revision: number) => ({
    accountId: account,
    revision,
    requestId: '00000000-0000-4000-8000-000000000003',
    asOf,
    createdAt: created,
    canonicalPayload: '{}',
  });
  const query = async (sql: string, params: unknown[] = []) => {
    const name = label(sql);
    calls.push([name, params]);
    switch (name) {
      case 'read account':
        return [{ id: account, currentRevision: world.revision }];
      case 'read journal':
        return world.journal ? [world.journal] : [];
      case 'read snapshot':
        return (world.snapshots ?? [])
          .filter((revision) => revision === params[2])
          .map((revision) => snapshot(revision));
      case 'read positions':
        return world.positions ?? [];
      case 'read lots':
        return world.lots ?? [];
      case 'read instruments':
        return labels.filter((row) => (params[1] as string[]).includes(row.id));
      default:
        return [];
    }
  };
  const manager = { query, queryRunner: { isTransactionActive: true } };
  const source = {
    transaction: async (level: unknown, work?: (manager: unknown) => unknown) =>
      (typeof level === 'function' ? level : work!)(manager),
  } as unknown as DataSource;
  return { calls, service: new CarryInService(source) };
}

const opening = (revision: number, positions: Position[]) => ({
  accountId: account,
  revision,
  requestId: '00000000-0000-4000-8000-000000000003',
  asOf: asOf.toISOString(),
  createdAt: created.toISOString(),
  positions,
});
const declared = {
  accountId: account,
  requestId: '00000000-0000-4000-8000-000000000004',
  canonicalPayload: '{}',
  coverageFrom: asOf,
  createdAt: created,
  currentRevision: 0,
  originKind: 'declared-empty',
  openingRevision: null,
};
const carried = { ...declared, originKind: 'known-cost-carry-in', openingRevision: 2 };
const start: [string, unknown[]][] = [
  ['read only', []],
  ['read account', [owner, account]],
  ['read journal', [owner, account]],
];

describe('CARRY-001-B characterization of the carry-in state', () => {
  const state = async (world: World) => {
    const { calls, service } = build(world);
    const result = await service.state(owner, account).catch((error: unknown) => error);
    return { calls, result };
  };

  it('CARRY-001-B an account without a journal and with a known-cost opening is eligible', async () => {
    const positions = [position(a, '1', '10')];
    const { calls, result } = await state({ revision: 3, snapshots: [3], positions });
    expect(result).toEqual({
      accountId: account,
      eligible: true,
      ineligibilityReason: null,
      opening: opening(3, positions),
      origin: null,
    });
    expect(calls).toEqual([
      ...start,
      ['read snapshot', [owner, account, 3]],
      ['read positions', [owner, account, 3]],
    ]);
  });

  it('CARRY-001-B an account without an opening revision has no current opening', async () => {
    const { calls, result } = await state({ revision: null });
    expect(result).toEqual({
      accountId: account,
      eligible: false,
      ineligibilityReason: 'no-current-opening',
      opening: null,
      origin: null,
    });
    expect(calls).toEqual(start);
  });

  it('CARRY-001-B a revision without a saved snapshot has no current opening', async () => {
    const { calls, result } = await state({ revision: 3 });
    expect(result).toMatchObject({ eligible: false, ineligibilityReason: 'no-current-opening' });
    expect(calls).toEqual([...start, ['read snapshot', [owner, account, 3]]]);
  });

  it('CARRY-001-B an unknown or missing cost is not eligible', async () => {
    for (const positions of [
      [position(a, '1', '10'), { ...position(b, '1', null), costStatus: 'unknown' as const }],
      [position(a, '1', null)],
    ]) {
      const { result } = await state({ revision: 3, snapshots: [3], positions });
      expect(result).toEqual({
        accountId: account,
        eligible: false,
        ineligibilityReason: 'unknown-cost',
        opening: opening(3, positions),
        origin: null,
      });
    }
  });

  it('CARRY-001-B a started journal wins over a missing opening', async () => {
    const { calls, result } = await state({ revision: null, journal: declared });
    expect(result).toEqual({
      accountId: account,
      eligible: false,
      ineligibilityReason: 'already-initialized',
      opening: null,
      origin: null,
    });
    expect(calls).toEqual(start);
  });

  it('CARRY-001-B a declared-empty journal reads the current opening and gives no origin', async () => {
    const positions = [{ ...position(a, '1', null), costStatus: 'unknown' as const }];
    const { result } = await state({ revision: 3, journal: declared, snapshots: [3], positions });
    expect(result).toEqual({
      accountId: account,
      eligible: false,
      ineligibilityReason: 'already-initialized',
      opening: opening(3, positions),
      origin: null,
    });
  });

  it('CARRY-001-B a carry-in journal reads its own opening revision and projects its origin', async () => {
    const positions = [position(a, '2', '20')];
    const lots = [
      {
        accountId: account,
        lotId: '00000000-0000-4000-8000-000000000005',
        openingRevision: 2,
        ordinal: 1,
        instrumentId: a,
        instrumentName: 'Label a1',
        instrumentSymbol: 'SYN',
        acquiredAt: new Date('2024-06-01T00:00:00.000Z'),
        orderWithinTimestamp: 0,
        originalQuantity: '4',
        originalCostUsd: '40',
        carriedQuantity: '2',
      },
    ];
    const { calls, result } = await state({
      revision: 3,
      journal: carried,
      snapshots: [2],
      positions,
      lots,
    });
    expect(result).toEqual({
      accountId: account,
      eligible: false,
      ineligibilityReason: 'already-initialized',
      opening: opening(2, positions),
      origin: {
        accountId: account,
        requestId: carried.requestId,
        originKind: 'known-cost-carry-in',
        coverageFrom: asOf.toISOString(),
        openingRevision: 2,
        lotCount: 1,
        carryInCostUsd: '20',
        createdAt: created.toISOString(),
      },
    });
    expect(calls).toEqual([
      ...start,
      ['read snapshot', [owner, account, 2]],
      ['read positions', [owner, account, 2]],
      ['read lots', [owner, [account], [2]]],
    ]);
  });

  it('CARRY-001-B a carry-in journal without its opening is refused before its lots are read', async () => {
    const { calls, result } = await state({ revision: 3, journal: carried, snapshots: [3] });
    expect(result).toEqual(new Error('Invalid saved carry-in opening'));
    expect(result).not.toBeInstanceOf(ConflictException);
    expect(calls).toEqual([...start, ['read snapshot', [owner, account, 2]]]);
  });
});

const lot = (
  instrumentId: string,
  acquiredAt: string,
  originalQuantity: string,
  originalCostUsd: string,
  remainingQuantity = originalQuantity,
) => ({
  instrumentId,
  acquiredAt,
  orderWithinTimestamp: 0,
  originalQuantity,
  originalCostUsd,
  remainingQuantity,
});

describe('CARRY-002-B characterization of the carry-in preview', () => {
  const preview = async (world: World, lots: object[], expectedOpeningRevision = 3) => {
    const { calls, service } = build(world);
    const result = await service
      .preview(owner, account, { expectedOpeningRevision, lots })
      .catch((error: unknown) => error);
    return { calls, result };
  };
  const one = [lot(a, '2024-06-01T00:00:00.000Z', '1', '10')];

  it('CARRY-002-B refuses an account whose journal has started', async () => {
    const { calls, result } = await preview({ revision: 3, journal: declared }, one);
    expect(result).toEqual(conflict);
    expect(calls).toEqual(start);
  });

  it('CARRY-002-B refuses a stale opening revision before any instrument is read', async () => {
    const { calls, result } = await preview({ revision: 4 }, one);
    expect(result).toEqual(conflict);
    expect(calls).toEqual(start);
  });

  it('CARRY-002-B refuses an instrument the owner does not have', async () => {
    const missing = '00000000-0000-4000-8000-0000000000f1';
    const { calls, result } = await preview({ revision: 3 }, [
      ...one,
      lot(missing, '2024-06-02T00:00:00.000Z', '1', '1'),
    ]);
    expect(result).toBeInstanceOf(NotFoundException);
    expect(calls).toEqual([...start, ['read instruments', [owner, [a, missing]]]]);
  });

  it('CARRY-002-B refuses a missing opening or an opening with an unknown cost', async () => {
    const missing = await preview({ revision: 3 }, one);
    expect(missing.result).toEqual(conflict);
    expect(missing.calls).toEqual([
      ...start,
      ['read instruments', [owner, [a]]],
      ['read snapshot', [owner, account, 3]],
    ]);
    const unknown = await preview(
      { revision: 3, snapshots: [3], positions: [position(a, '1', null)] },
      one,
    );
    expect(unknown.result).toEqual(conflict);
  });

  it('CARRY-002-B a lot set that matches the opening exactly can initialize', async () => {
    const { calls, result } = await preview(
      { revision: 3, snapshots: [3], positions: [position(a, '1', '10')] },
      one,
    );
    expect(result).toEqual({
      accountId: account,
      openingRevision: 3,
      coverageFrom: asOf.toISOString(),
      canInitialize: true,
      issues: [],
      lots: [
        {
          ...one[0],
          ordinal: 1,
          instrumentName: 'Label a1',
          instrumentSymbol: 'SYN',
          priorDisposedQuantity: '0',
          priorAllocatedCostUsd: '0',
          carriedCostUsd: '10',
        },
      ],
      reconciliation: [
        {
          instrumentId: a,
          instrumentName: 'Opening a1',
          instrumentSymbol: null,
          openingQuantity: '1',
          openingCostUsd: '10',
          carriedQuantity: '1',
          carriedCostUsd: '10',
        },
      ],
      carryInCostUsd: '10',
    });
    expect(calls).toEqual([
      ...start,
      ['read instruments', [owner, [a]]],
      ['read snapshot', [owner, account, 3]],
      ['read positions', [owner, account, 3]],
    ]);
  });

  it('CARRY-002-B reports every issue in its fixed order with an exact reconciliation', async () => {
    const lots = [
      lot(e, '2024-06-05T00:00:00.000Z', '1', '2'),
      lot(a, '2024-06-01T00:00:00.000Z', '4', '40'),
      lot(c, '2024-06-04T00:00:00.000Z', '2', '30'),
      lot(a, '2025-01-01T00:00:00.001Z', '12', '72', '6'),
      lot(b, '2024-06-03T00:00:00.000Z', '5', '45'),
    ];
    const positions = [
      position(a, '10', '76'),
      position(b, '5', '50'),
      position(c, '3', '30'),
      position(d, '1', '1'),
    ];
    const { result } = await preview({ revision: 3, snapshots: [3], positions }, lots);
    const view = (
      instrumentId: string,
      carriedQuantity: string,
      carriedCostUsd: string,
      opening?: Position,
    ) => ({
      instrumentId,
      instrumentName: opening ? opening.instrumentName : `Label ${instrumentId.slice(-2)}`,
      instrumentSymbol: opening ? null : 'SYN',
      openingQuantity: opening?.quantity ?? null,
      openingCostUsd: opening?.totalCostUsd ?? null,
      carriedQuantity,
      carriedCostUsd,
    });
    expect(result).toMatchObject({
      canInitialize: false,
      issues: [
        { code: 'acquisition-after-coverage', instrumentId: null, ordinal: 5 },
        { code: 'extra-instrument', instrumentId: e, ordinal: null },
        { code: 'missing-instrument', instrumentId: d, ordinal: null },
        { code: 'quantity-mismatch', instrumentId: c, ordinal: null },
        { code: 'cost-mismatch', instrumentId: b, ordinal: null },
      ],
      reconciliation: [
        view(a, '10', '76', positions[0]),
        view(b, '5', '45', positions[1]),
        view(c, '2', '30', positions[2]),
        view(d, '0', '0', positions[3]),
        view(e, '1', '2'),
      ],
      carryInCostUsd: '153',
    });
    expect((result as { lots: object[] }).lots).toEqual([
      expect.objectContaining({ ordinal: 1, instrumentId: a, carriedCostUsd: '40' }),
      expect.objectContaining({ ordinal: 2, instrumentId: b, carriedCostUsd: '45' }),
      expect.objectContaining({ ordinal: 3, instrumentId: c, carriedCostUsd: '30' }),
      expect.objectContaining({ ordinal: 4, instrumentId: e, carriedCostUsd: '2' }),
      expect.objectContaining({
        ordinal: 5,
        instrumentId: a,
        priorDisposedQuantity: '6',
        priorAllocatedCostUsd: '36',
        carriedCostUsd: '36',
      }),
    ]);
  });
});
