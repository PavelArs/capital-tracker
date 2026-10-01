import {
  parseRewardCorrection,
  parseRewardCreate,
  parseRewardVoid,
  rewardPayload,
} from './asset-reward-input';

const instrument = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const request = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const target = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const valid = () => ({
  requestId: request,
  expectedJournalRevision: 0,
  assertReward: true,
  instrumentId: instrument,
  category: 'staking',
  occurredAt: '2025-01-02T00:00:00.000Z',
  orderWithinTimestamp: 0,
  quantity: '2',
  acquisitionBasisUsd: null,
  incomeValueUsd: '40',
});
const invalid = (action: () => unknown) => {
  expect(action).toThrow(expect.objectContaining({ status: 400 }));
};

describe('REWARD-001/006 strict command input', () => {
  it('preserves explicit unknown, known zero and separate income', () => {
    expect(parseRewardCreate(valid())).toEqual(valid());
    expect(
      parseRewardCreate({ ...valid(), acquisitionBasisUsd: '0.000', incomeValueUsd: null }),
    ).toEqual({ ...valid(), acquisitionBasisUsd: '0', incomeValueUsd: null });
    for (const category of ['staking', 'airdrop', 'other', 'unclassified']) {
      expect(parseRewardCreate({ ...valid(), category }).category).toBe(category);
    }
  });

  it('canonicalizes UUID, instant and decimal spellings without conflating null and zero', () => {
    const first = parseRewardCreate(valid());
    const equivalent = parseRewardCreate({
      ...valid(),
      requestId: request.toUpperCase(),
      instrumentId: instrument.toUpperCase(),
      occurredAt: '2025-01-02T02:00:00+02:00',
      quantity: '2.0000',
      incomeValueUsd: '40.0000',
      orderWithinTimestamp: -0,
    });
    expect(equivalent).toEqual(first);
    expect(rewardPayload('create', first)).toBe(rewardPayload('create', equivalent));
    expect(rewardPayload('create', first)).not.toBe(
      rewardPayload('create', { ...first, acquisitionBasisUsd: '0' }),
    );
    expect(rewardPayload('create', first)).not.toBe(
      rewardPayload('create', { ...first, expectedJournalRevision: 1 }),
    );
  });

  it('requires every declared field and literal attestation before coercion', () => {
    for (const key of Object.keys(valid())) {
      const value = { ...valid() } as Record<string, unknown>;
      delete value[key];
      invalid(() => parseRewardCreate(value));
    }
    for (const value of [false, 1, 'true', null, {}, []])
      invalid(() => parseRewardCreate({ ...valid(), assertReward: value }));
    for (const value of ['reward', 'deposit', '', null, [], {}])
      invalid(() => parseRewardCreate({ ...valid(), category: value }));
    for (const key of [
      'ownerId',
      'accountId',
      'rewardId',
      'kind',
      'version',
      'summary',
      'expectedVersion',
    ]) {
      invalid(() => parseRewardCreate({ ...valid(), [key]: target }));
    }
  });

  it('rejects numeric coercion, malformed decimals and raw precision overflow', () => {
    for (const field of ['quantity', 'acquisitionBasisUsd', 'incomeValueUsd']) {
      for (const value of [
        1,
        false,
        {},
        [],
        ['1'],
        '',
        ' 1',
        '1 ',
        '1e2',
        '1,2',
        'NaN',
        'Infinity',
        '-1',
        '.1',
        `${'9'.repeat(49)}`,
        `0.${'0'.repeat(30)}1`,
      ]) {
        invalid(() => parseRewardCreate({ ...valid(), [field]: value }));
      }
    }
    invalid(() => parseRewardCreate({ ...valid(), quantity: '0' }));
    invalid(() => parseRewardCreate({ ...valid(), quantity: null }));
    const maximum = `${'9'.repeat(48)}.${'9'.repeat(30)}`;
    expect(
      parseRewardCreate({
        ...valid(),
        quantity: maximum,
        acquisitionBasisUsd: maximum,
        incomeValueUsd: maximum,
      }).quantity,
    ).toBe(maximum);
  });

  it('validates explicit dates, raw integers and full correction identity', () => {
    for (const occurredAt of [
      '2025-01-02',
      '2025-02-29T00:00:00Z',
      '2025-01-02T00:00:00.0001Z',
      '1969-12-31T23:59:59Z',
    ]) {
      invalid(() => parseRewardCreate({ ...valid(), occurredAt }));
    }
    for (const expectedJournalRevision of ['0', false, null, {}, -1, 10001, 0.5]) {
      invalid(() => parseRewardCreate({ ...valid(), expectedJournalRevision }));
    }
    for (const orderWithinTimestamp of ['0', null, -1, 2147483648, 0.5]) {
      invalid(() => parseRewardCreate({ ...valid(), orderWithinTimestamp }));
    }
    const command = parseRewardCorrection({ ...valid(), expectedVersion: 1 });
    expect(command).toEqual({ ...valid(), expectedVersion: 1 });
    expect(rewardPayload('correct', command, target)).not.toBe(
      rewardPayload('correct', command, instrument),
    );
    invalid(() => parseRewardCorrection(valid()));
  });

  it('allows only pins and request identity for terminal void', () => {
    const command = { requestId: request, expectedJournalRevision: 2, expectedVersion: 1 };
    expect(parseRewardVoid(command)).toEqual(command);
    for (const expectedVersion of [0, 10001, '1', false, null])
      invalid(() => parseRewardVoid({ ...command, expectedVersion }));
    invalid(() => parseRewardVoid({ ...command, quantity: '1' }));
    invalid(() => parseRewardVoid({ ...command, assertReward: true }));
    expect(rewardPayload('void', command, target)).not.toBe(
      rewardPayload('correct', { ...valid(), expectedVersion: 1 }, target),
    );
  });
});
