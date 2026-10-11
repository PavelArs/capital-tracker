import {
  type AuditRow,
  auditFields,
  encodeCursor,
  humanize,
  legSymbol,
  parseAuditQuery,
  projectEvent,
  trimDecimal,
} from './audit-history';

const at = new Date('2026-10-09T12:00:00.000Z');
function row(overrides: Partial<AuditRow>): AuditRow {
  return {
    entity: 'trade',
    entityId: 'trade-1',
    version: 1,
    change: 'created',
    actor: 'owner',
    createdAt: at,
    occurredAt: new Date('2026-10-01T00:00:00.000Z'),
    account: 'Bybit',
    snapshot: {},
    previous: null,
    ...overrides,
  };
}
const buy = {
  side: 'buy',
  asset: 'BTC',
  quantity: '0.500000000000000000000000000000',
  grossUsd: '30000.000000000000000000000000000000',
  feeUsd: '0.000000000000000000000000000000',
  occurredAt: '2026-10-01T00:00:00.000Z',
  paidGross: null,
  paidCurrency: null,
  comment: null,
};

describe('trimDecimal', () => {
  it('drops the zeros the database pads a decimal with', () => {
    expect(trimDecimal('0.500000000000000000000000000000')).toBe('0.5');
    expect(trimDecimal('30000.000000000000000000000000000000')).toBe('30000');
    expect(trimDecimal('0.000')).toBe('0');
    expect(trimDecimal('120')).toBe('120');
    expect(trimDecimal('0.00918359')).toBe('0.00918359');
  });
});

describe('auditFields', () => {
  it('lists everything a created version holds, without the values it does not have', () => {
    const fields = auditFields(row({ snapshot: buy }));
    expect(fields.map((field) => field.label)).toEqual([
      'Side',
      'Quantity',
      'Amount',
      'Fee',
      'Date',
    ]);
    expect(fields.every((field) => field.before === null)).toBe(true);
    expect(fields[1].after).toEqual({ kind: 'quantity', value: '0.5', unit: 'BTC' });
    expect(fields[2].after).toEqual({ kind: 'usd', value: '30000', unit: null });
  });

  it('lists only what a correction changed, with both values', () => {
    const fields = auditFields(
      row({
        version: 2,
        change: 'changed',
        snapshot: { ...buy, grossUsd: '31000.000000000000000000000000000000', comment: 'Fixed' },
        previous: buy,
      }),
    );
    expect(fields).toEqual([
      {
        label: 'Amount',
        before: { kind: 'usd', value: '30000', unit: null },
        after: { kind: 'usd', value: '31000', unit: null },
      },
      { label: 'Comment', before: null, after: { kind: 'text', value: 'Fixed', unit: null } },
    ]);
  });

  it('treats padded zeros as no change', () => {
    expect(
      auditFields(
        row({
          version: 2,
          change: 'changed',
          snapshot: { ...buy, quantity: '0.5' },
          previous: buy,
        }),
      ),
    ).toEqual([]);
  });

  it('shows a deleted version as what was taken away', () => {
    const fields = auditFields(
      row({ version: 2, change: 'deleted', snapshot: buy, previous: { ...buy, comment: 'Old' } }),
    );
    expect(fields.map((field) => [field.label, field.after])).toEqual([
      ['Side', null],
      ['Quantity', null],
      ['Amount', null],
      ['Fee', null],
      ['Date', null],
      ['Comment', null],
    ]);
    expect(fields.at(-1)?.before?.value).toBe('Old');
  });

  it('shows a fee only when there is one, in its own asset', () => {
    const fields = auditFields(
      row({
        entity: 'transfer',
        snapshot: {
          asset: 'BTC',
          quantity: '0.1',
          to: 'Cold storage',
          feeQuantity: '0.0001',
          feeAsset: 'BTC',
          occurredAt: '2026-10-01T00:00:00.000Z',
        },
      }),
    );
    expect(fields.map((field) => field.label)).toEqual(['Quantity', 'To', 'Fee', 'Date']);
    expect(fields[2].after).toEqual({ kind: 'quantity', value: '0.0001', unit: 'BTC' });
    const free = auditFields(
      row({
        entity: 'transfer',
        snapshot: { asset: 'BTC', quantity: '0.1', to: 'Cold', feeQuantity: '0.000000' },
      }),
    );
    expect(free.map((field) => field.label)).toEqual(['Quantity', 'To']);
  });

  it('names a classification answer by status and type and notes updated details', () => {
    const base = { status: 'classified', type: 'buy', comment: null, details: 'aaa' };
    const same = auditFields(
      row({
        entity: 'classification',
        version: 2,
        change: 'changed',
        snapshot: { ...base, comment: 'Looked again' },
        previous: base,
      }),
    );
    expect(same.map((field) => field.label)).toEqual(['Comment']);
    const amounts = auditFields(
      row({
        entity: 'classification',
        version: 2,
        change: 'changed',
        snapshot: { ...base, details: 'bbb' },
        previous: base,
      }),
    );
    expect(amounts).toEqual([
      {
        label: 'Details',
        before: { kind: 'text', value: 'Recorded', unit: null },
        after: { kind: 'text', value: 'Updated', unit: null },
      },
    ]);
    const hidden = auditFields(
      row({
        entity: 'classification',
        snapshot: { status: 'hidden', type: null, comment: 'Dust', details: null },
      }),
    );
    expect(hidden.map((field) => field.after?.value)).toEqual(['Hidden', 'Dust']);
  });
});

describe('projectEvent', () => {
  it('names the operation and keeps its own date apart from the time of the change', () => {
    const event = projectEvent(row({ snapshot: buy }));
    expect(event).toMatchObject({
      id: 'trade:trade-1:000001',
      at: '2026-10-09T12:00:00.000Z',
      title: 'Buy BTC',
      asset: 'BTC',
      account: 'Bybit',
      occurredAt: '2026-10-01T00:00:00.000Z',
      change: 'created',
      actor: 'owner',
    });
  });

  it('names a void after the version it deletes', () => {
    const event = projectEvent(
      row({
        version: 2,
        change: 'deleted',
        snapshot: { side: 'sell', asset: 'ETH' },
        previous: { side: 'buy', asset: 'BTC' },
      }),
    );
    expect(event.title).toBe('Buy BTC');
  });

  it('titles every kind of entry', () => {
    const title = (entity: AuditRow['entity'], snapshot: AuditRow['snapshot']) =>
      projectEvent(row({ entity, snapshot })).title;
    expect(title('transfer', { asset: 'ETH' })).toBe('Transfer ETH');
    expect(title('swap', { gaveAsset: 'USDT', gotAsset: 'BTC' })).toBe('Swap USDT → BTC');
    expect(title('reward', { asset: 'SOL' })).toBe('Reward SOL');
    expect(title('flow', { direction: 'contribution' })).toBe('Deposit');
    expect(title('flow', { direction: 'withdrawal' })).toBe('Withdrawal');
    expect(title('price', { asset: 'XYZ' })).toBe('Manual price XYZ');
    expect(title('classification', { direction: 'in', network: 'bitcoin', asset: null })).toBe(
      'Incoming BTC',
    );
    expect(title('classification', { direction: 'out', network: 'bybit', asset: 'SUI' })).toBe(
      'Outgoing SUI',
    );
  });

  it('places a classification without an account in its network', () => {
    const event = projectEvent(
      row({
        entity: 'classification',
        account: null,
        snapshot: { direction: 'in', network: 'ethereum', asset: null },
      }),
    );
    expect(event.account).toBe('Ethereum wallet');
  });
});

describe('legSymbol', () => {
  it('falls back to the stored name of a token it does not know', () => {
    expect(legSymbol('ethereum', null)).toBe('ETH');
    expect(legSymbol('ethereum', '0xunknowncontract')).toBe('0xunknowncontract');
    expect(legSymbol(null, 'ABC')).toBe('ABC');
  });
});

describe('humanize', () => {
  it('capitalises a stored word', () => {
    expect(humanize('staking-reward')).toBe('Staking reward');
    expect(humanize('buy')).toBe('Buy');
  });
});

describe('parseAuditQuery', () => {
  it('defaults to the newest 50 of everything', () => {
    expect(parseAuditQuery({})).toEqual({
      entity: null,
      change: null,
      actor: null,
      from: null,
      to: null,
      limit: 50,
      before: null,
    });
  });

  it('accepts every filter and a cursor it handed out', () => {
    const cursor = encodeCursor({ at: '2026-10-09T12:00:00.000Z', id: 'trade:trade-1:000002' });
    expect(
      parseAuditQuery({
        entity: 'swap',
        change: 'deleted',
        actor: 'csv',
        from: '2026-10-01',
        to: '2026-10-31',
        limit: '200',
        before: cursor,
      }),
    ).toEqual({
      entity: 'swap',
      change: 'deleted',
      actor: 'csv',
      from: '2026-10-01',
      to: '2026-10-31',
      limit: 200,
      before: { at: '2026-10-09T12:00:00.000Z', key: 'trade:trade-1:000002' },
    });
  });

  it.each([
    [{ entity: 'account' }],
    [{ change: 'removed' }],
    [{ actor: 'robot' }],
    [{ from: '2026-02-30' }],
    [{ to: '10/01/2026' }],
    [{ from: '2026-10-02', to: '2026-10-01' }],
    [{ limit: '0' }],
    [{ limit: '201' }],
    [{ limit: '1.5' }],
    [{ before: '%%%' }],
    [{ before: Buffer.from('[1]').toString('base64url') }],
    [{ other: '1' }],
    [{ entity: ['trade'] }],
    [[]],
    [null],
  ])('refuses %j', (query) => {
    expect(() => parseAuditQuery(query)).toThrow();
  });
});
