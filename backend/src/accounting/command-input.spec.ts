import { BadRequestException } from '@nestjs/common';
import { parseRewardCorrection, parseRewardCreate, parseRewardVoid } from './asset-reward-input';
import {
  parseSwapAllocationQuery,
  parseSwapCorrection,
  parseSwapCreate,
  parseSwapVoid,
  swapPayload,
} from './asset-swap-input';
import {
  parseTransferAllocationQuery,
  parseTransferCorrection,
  parseTransferCreate,
  parseTransferVoid,
} from './owned-transfer-input';

// Characterization of the strict reading the reward, swap and transfer commands share: one
// refusal, plain bodies, integer pins and query integers. Synthetic identifiers only.
const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const first = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const second = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const occurredAt = '2025-01-02T00:00:00.000Z';

const reward = {
  assertReward: true,
  instrumentId: first,
  category: 'staking',
  occurredAt,
  orderWithinTimestamp: 0,
  quantity: '2',
  acquisitionBasisUsd: null,
  incomeValueUsd: '40',
};
const swap = {
  assertExecuted: true,
  outgoingInstrumentId: first,
  incomingInstrumentId: second,
  occurredAt,
  orderWithinTimestamp: 0,
  outgoingQuantity: '1.25',
  incomingQuantity: '2',
  considerationUsd: null,
  feeSource: null,
  feeInstrumentId: null,
  feeQuantity: '0',
};
const movement = {
  assertInternal: true,
  instrumentId: first,
  occurredAt,
  orderWithinTimestamp: 0,
  quantity: '1.5',
  feeInstrumentId: null,
  feeQuantity: '0',
};
const journalPin = { requestId, expectedJournalRevision: 4 };
const transferPins = { requestId, expectedFromJournalRevision: 2, expectedToJournalRevision: 0 };

type Parse = (raw: unknown) => object;
/** Name, parser, a valid body, its journal revision pins, and whether it names a version. */
const commands: [string, Parse, Record<string, unknown>, string[], boolean][] = [
  [
    'reward create',
    parseRewardCreate,
    { ...journalPin, ...reward },
    ['expectedJournalRevision'],
    false,
  ],
  [
    'reward correction',
    parseRewardCorrection,
    { ...journalPin, expectedVersion: 1, ...reward },
    ['expectedJournalRevision'],
    true,
  ],
  [
    'reward void',
    parseRewardVoid,
    { ...journalPin, expectedVersion: 1 },
    ['expectedJournalRevision'],
    true,
  ],
  ['swap create', parseSwapCreate, { ...journalPin, ...swap }, ['expectedJournalRevision'], false],
  [
    'swap correction',
    parseSwapCorrection,
    { ...journalPin, expectedVersion: 1, ...swap },
    ['expectedJournalRevision'],
    true,
  ],
  [
    'swap void',
    parseSwapVoid,
    { ...journalPin, expectedVersion: 1 },
    ['expectedJournalRevision'],
    true,
  ],
  [
    'transfer create',
    parseTransferCreate,
    { ...transferPins, fromAccountId: first, toAccountId: second, ...movement },
    ['expectedFromJournalRevision', 'expectedToJournalRevision'],
    false,
  ],
  [
    'transfer correction',
    parseTransferCorrection,
    { ...transferPins, expectedVersion: 1, ...movement },
    ['expectedFromJournalRevision', 'expectedToJournalRevision'],
    true,
  ],
  [
    'transfer void',
    parseTransferVoid,
    { ...transferPins, expectedVersion: 1 },
    ['expectedFromJournalRevision', 'expectedToJournalRevision'],
    true,
  ],
];
const ordered = commands.filter(([, , valid]) => 'orderWithinTimestamp' in valid);
const versioned = commands.filter(([, , , , named]) => named);
const pins = commands.flatMap(([name, parse, valid, keys]) =>
  keys.map((key) => [name, key, parse, valid] as const),
);

/** The one refusal every malformed command or query gets: 400 with the same message. */
function refused(action: () => unknown) {
  expect(action).toThrow(BadRequestException);
  expect(action).toThrow(/^Invalid accounting input$/);
}
const read = (parse: Parse, valid: Record<string, unknown>, key: string, value: unknown) =>
  (parse({ ...valid, [key]: value }) as Record<string, unknown>)[key];

describe('strict reading shared by the reward, swap and transfer commands', () => {
  it.each(commands)(
    '%s reads its valid body and lowercases the request key',
    (_name, parse, valid) => {
      expect(parse(valid)).toEqual(valid);
      expect(parse({ ...valid, requestId: requestId.toUpperCase() })).toEqual(valid);
      expect(parse(Object.assign(Object.create(null), valid))).toEqual(valid);
    },
  );

  it.each(commands)(
    '%s refuses anything but a plain body of its own keys',
    (_name, parse, valid) => {
      class Body {}
      for (const raw of [
        undefined,
        null,
        'body',
        1,
        true,
        [],
        new Date(0),
        Object.assign(new Body(), valid),
        Object.create(valid),
        { ...valid, unexpected: 1 },
        { ...valid, [Symbol('unexpected')]: 1 },
      ])
        refused(() => parse(raw));
    },
  );

  it.each(pins)('%s pins %s from 0 to 10000, reading -0 as 0', (_name, key, parse, valid) => {
    expect(read(parse, valid, key, 0)).toBe(0);
    expect(read(parse, valid, key, 10000)).toBe(10000);
    expect(Object.is(read(parse, valid, key, -0), 0)).toBe(true);
    for (const value of [
      -1,
      10001,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      2 ** 53,
      '0',
      true,
      null,
    ])
      refused(() => parse({ ...valid, [key]: value }));
  });

  it.each(versioned)('%s names an expected version from 1 to 10000', (_name, parse, valid) => {
    expect(read(parse, valid, 'expectedVersion', 1)).toBe(1);
    expect(read(parse, valid, 'expectedVersion', 10000)).toBe(10000);
    for (const value of [0, -0, 10001, 1.5, '1', null])
      refused(() => parse({ ...valid, expectedVersion: value }));
  });

  it.each(ordered)(
    '%s orders within a timestamp from 0 to 2147483647, reading -0 as 0',
    (_name, parse, valid) => {
      expect(read(parse, valid, 'orderWithinTimestamp', 2147483647)).toBe(2147483647);
      expect(Object.is(read(parse, valid, 'orderWithinTimestamp', -0), 0)).toBe(true);
      for (const value of [-1, 2147483648, 0.5, '0'])
        refused(() => parse({ ...valid, orderWithinTimestamp: value }));
    },
  );

  it('refuses a swap payload whose kind does not fit its input', () => {
    const created = parseSwapCreate({ ...journalPin, ...swap });
    const voided = parseSwapVoid({ ...journalPin, expectedVersion: 1 });
    refused(() => swapPayload('void', created, first));
    refused(() => swapPayload('correct', voided, first));
    refused(() => swapPayload('create', voided));
    refused(() => swapPayload('void', voided));
  });
});

/** Name, parser and the two pins an allocation continuation names. */
const allocations: [string, (raw: unknown) => object, string, string][] = [
  ['swap', parseSwapAllocationQuery, 'journalRevision', 'expectedVersion'],
  ['transfer', parseTransferAllocationQuery, 'fromJournalRevision', 'toJournalRevision'],
];

describe('query integers shared by the swap and transfer allocation reads', () => {
  it.each(allocations)(
    '%s reads digit strings within their bounds',
    (_name, parse, revision, other) => {
      const pinned = { [revision]: '0', [other]: '10000' };
      expect(parse({ ...pinned, offset: '99999', limit: '1' })).toEqual({
        [revision]: 0,
        [other]: 10000,
        offset: 99999,
        limit: 1,
      });
      expect(parse({ [revision]: '10000', [other]: '1', offset: '0', limit: '100' })).toEqual({
        [revision]: 10000,
        [other]: 1,
        offset: 0,
        limit: 100,
      });
    },
  );

  it.each(allocations)(
    '%s refuses any other spelling of a query integer',
    (_name, parse, revision, other) => {
      const pinned = { [revision]: '1', [other]: '1' };
      for (const value of [
        '',
        '00',
        '01',
        '-1',
        '+1',
        '1.0',
        ' 1',
        '1 ',
        '1e3',
        '0x1',
        '100000',
        '000001',
        1,
        ['1'],
        null,
      ]) {
        refused(() => parse({ ...pinned, offset: value }));
        refused(() => parse({ ...pinned, limit: value }));
        refused(() => parse({ ...pinned, [revision]: value }));
      }
      for (const query of [
        { ...pinned, [revision]: '10001' },
        { ...pinned, limit: '0' },
        { ...pinned, limit: '101' },
      ])
        refused(() => parse(query));
    },
  );
});
