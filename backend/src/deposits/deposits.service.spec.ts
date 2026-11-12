import { createHash } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { type AccountingCurrency, FxConverter, type FxRates } from '../fx-rates/fx-conversion';
import { buildSeries } from '../inflation/inflation-math';
import { inflationReadings } from './deposit-real';
import type { DepositRow, MovementRow, RateRow, Stored } from './deposit-store';
import { DepositsService } from './deposits.service';

// Characterization of a deposit's view and of a rate change: what each computes and writes, with
// each query answered by a stub. The stored rows themselves are probed in tests/e2e.
// Synthetic figures only.
const owner = '00000000-0000-4000-8000-000000000001';
const depositId = '00000000-0000-4000-8000-0000000000d1';

const depositRow = (change: Partial<DepositRow> = {}): DepositRow => ({
  id: depositId,
  kind: 'term-deposit',
  name: 'Synthetic deposit',
  bank: 'Synthetic bank',
  currency: 'RUB',
  startDate: '2026-01-01',
  endDate: '2026-07-01',
  payout: 'monthly',
  capitalized: false,
  dayBasis: 'actual-365',
  earlyClose: 'forfeits-interest',
  ...change,
});
const rate = (effectiveFrom: string, ratePercent: string): RateRow => ({
  depositId,
  effectiveFrom,
  ratePercent,
});
const movement = (
  occurredOn: string,
  kind: MovementRow['kind'],
  amount: string,
  comment: string | null = null,
): MovementRow => ({
  id: `movement-${occurredOn}-${kind}`,
  depositId,
  occurredOn,
  kind,
  amount,
  comment,
});
const stored = (
  change: Partial<Omit<Stored, 'deposit'>> & { deposit?: Partial<DepositRow> } = {},
): Stored => ({
  rates: [rate('2026-01-01', '12')],
  movements: [movement('2026-01-01', 'topup', '100000.00')],
  checks: [],
  ...change,
  deposit: depositRow(change.deposit),
});

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

describe('DEP-VIEW characterization of a deposit read on a day', () => {
  const days = (from: string, to: string) => {
    const out: string[] = [];
    for (let at = Date.parse(from); at <= Date.parse(to); at += 86_400_000)
      out.push(new Date(at).toISOString().slice(0, 10));
    return out;
  };
  const fxRates: FxRates = {
    USD: days('2025-12-20', '2026-12-31').map((date) => ({ date, rubPerUnit: '80' })),
    EUR: days('2025-12-20', '2026-12-31').map((date) => ({ date, rubPerUnit: '90' })),
  };
  const converters = (rates: FxRates = fxRates) =>
    new Map(
      (['USD', 'EUR', 'RUB'] as AccountingCurrency[]).map((currency) => [
        currency,
        new FxConverter(rates, currency),
      ]),
    );
  const monthly = new Map<string, number>();
  for (let month = 1; month <= 12; month++)
    monthly.set(`2025-${String(month).padStart(2, '0')}`, 1);
  for (let month = 1; month <= 5; month++) monthly.set(`2026-${String(month).padStart(2, '0')}`, 1);
  const readings = inflationReadings(buildSeries(monthly), '8');
  const service = new DepositsService({} as DataSource) as unknown as {
    view: (...args: unknown[]) => Record<string, unknown>;
  };
  const view = (deposit: Stored, asOf: string, withReadings = true, rates?: FxRates) =>
    service.view(deposit, asOf, converters(rates), withReadings ? readings : undefined);

  it('DEP-VIEW an active term deposit with checks before and after the day', () => {
    const deposit = stored({
      checks: [
        { id: 'c1', depositId, checkedOn: '2026-03-01', bankBalance: '100000.00' },
        { id: 'c2', depositId, checkedOn: '2026-05-01', bankBalance: '100500.00' },
      ],
    });
    const result = view(deposit, '2026-04-15');
    expect(result).toMatchObject({
      status: 'active',
      ratePercent: '12',
      interestMissing: false,
      lastCheck: { checkedOn: '2026-03-01' },
      real: { official: expect.any(Object), personal: expect.any(Object) },
      nextPayout: expect.any(Object),
      atMaturity: { date: '2026-07-01', inTodaysMoney: expect.any(Object) },
    });
    expect(digest(result)).toBe('d4f88306c4b8fc73ae4fb75af76bfab00b850846aba7a6c1760801f3c8376465');
  });

  it('DEP-VIEW a matured term deposit states its end and no next payout', () => {
    const result = view(stored({ deposit: { capitalized: true } }), '2026-07-01');
    expect(result).toMatchObject({
      status: 'matured',
      nextPayout: null,
      atMaturity: { date: '2026-07-01', balance: '106100.16', interest: '6100.16' },
    });
    expect(digest(result)).toBe('a2228c60e25db2721084e1cc2eaad4e465f14786197b38f8c591916ea1de2b1e');
  });

  it('DEP-VIEW a deposit emptied before its end is closed', () => {
    const deposit = stored({
      movements: [
        movement('2026-01-01', 'topup', '100000.00'),
        movement('2026-02-15', 'withdrawal', '100000.00'),
      ],
    });
    const result = view(deposit, '2026-03-01');
    expect(result).toMatchObject({ status: 'closed', closedOn: '2026-02-15', atMaturity: null });
    expect(digest(result)).toBe('dc30fabd7235d809b6d66725da8ba3cd3765238a97b97eeff79a4c416ffc9c74');
  });

  it('DEP-ACCOUNT an account before its first rate states no rate and no interest', () => {
    const deposit = stored({
      deposit: { kind: 'account', endDate: null, payout: 'monthly', capitalized: true },
      rates: [rate('2026-03-01', '10')],
    });
    const before = view(deposit, '2026-02-01');
    expect(before).toMatchObject({
      status: 'active',
      ratePercent: null,
      interestMissing: true,
      accrued: null,
      due: null,
      interestEarned: null,
      nextPayout: null,
      atMaturity: null,
      real: { official: null, personal: null },
    });
    expect(digest(before)).toBe('af535f1613fb35800f82faf883791ccdd949ece45cd96cfcbaeefde10a28582e');
    const after = view(deposit, '2026-04-10');
    expect(after).toMatchObject({ ratePercent: '10', interestMissing: true });
    expect(digest(after)).toBe('12d22f9f21e022e373c3f4a0b96fa4757016cccc8a4fb28bf416a3e4b97c5554');
  });

  it('DEP-ACCOUNT an account paid out, not capitalized, with a rate from a later day', () => {
    const deposit = stored({
      deposit: { kind: 'account', endDate: null, payout: 'monthly', capitalized: false },
      rates: [rate('2026-02-10', '9')],
      checks: [{ id: 'c1', depositId, checkedOn: '2026-03-01', bankBalance: '100100.00' }],
    });
    const result = view(deposit, '2026-04-10');
    expect(result).toMatchObject({ lastCheck: { calculated: null, difference: null } });
    expect(digest(result)).toBe('94ade39246ff29c0cd127c44c47eebfd3d797ade3f79dee1348a69339e81ec63');
  });

  it('DEP-ACCOUNT an account with a rate from its opening day and no term', () => {
    const deposit = stored({
      deposit: { kind: 'account', endDate: null, payout: 'daily', capitalized: true },
      rates: [rate('2026-01-01', '0'), rate('2026-02-01', '7.5')],
    });
    const result = view(deposit, '2026-03-15');
    expect(result).toMatchObject({ ratePercent: '7.5', interestMissing: false, atMaturity: null });
    expect(digest(result)).toBe('207eb01cc14ff7527b8d4a01a7456fb35125cc9213481cd190848ef898cd1ba5');
  });

  it('DEP-VIEW without inflation readings or rates the real figures and values are not stated', () => {
    const result = view(stored({ deposit: { currency: 'USD' } }), '2026-04-15', false, {
      USD: [],
      EUR: [],
    });
    expect(result).toMatchObject({
      real: { official: null, personal: null },
      values: { USD: '103419.18', EUR: null, RUB: null },
    });
    expect(digest(result)).toBe('f54c4e83f060fbdb4e8b08e27cd2b0309b3d720fe07b58eac4202b32392f39c1');
  });

  it('DEP-VIEW a term deposit read before its first rate takes effect', () => {
    const deposit = stored({ rates: [rate('2026-01-10', '11')] });
    const result = view(deposit, '2026-01-05');
    expect(result).toMatchObject({ ratePercent: '11' });
    expect(digest(result)).toBe('728678b126230b1897015a5665a514c4affba74a069082f626970c870a9f007c');
  });
});

describe('DEP-RATE characterization of a rate change', () => {
  interface Call {
    sql: string;
    parameters: unknown[];
  }
  const today = new Date('2026-06-15T12:00:00.000Z');
  beforeEach(() => jest.useFakeTimers({ now: today }));
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  async function addRate(deposit: Stored, raw: unknown, changed = true) {
    const calls: Call[] = [];
    // A statement is answered by the first fragment it holds; any other returns nothing.
    const answers: [string, () => unknown[]][] = [
      ['SELECT id FROM bank_deposits', () => [{ id: depositId }]],
      ['FROM bank_deposits WHERE', () => [deposit.deposit]],
      ['FROM bank_deposit_rates', () => deposit.rates],
      ['FROM bank_deposit_movements', () => deposit.movements],
      ['FROM bank_deposit_checks', () => deposit.checks],
      ['INSERT INTO bank_deposit_rates', () => (changed ? [{ '?column?': 1 }] : [])],
    ];
    const manager = {
      queryRunner: { isTransactionActive: true },
      query: async (sql: string, parameters: unknown[] = []) => {
        calls.push({ sql, parameters });
        return answers.find(([fragment]) => sql.includes(fragment))?.[1]() ?? [];
      },
    };
    const source = { transaction: async (work: (m: unknown) => unknown) => work(manager) };
    const service = new DepositsService(source as unknown as DataSource);
    jest.spyOn(service, 'get').mockResolvedValue('read back' as never);
    const outcome = await service.addRate(owner, depositId, raw).then(
      (value) => ({ value }),
      (error: Error) => ({ error: error.constructor.name, message: error.message }),
    );
    return { outcome, calls };
  }
  const refused = (error: string, message: string) => ({ error, message });
  const kinds = (calls: readonly Call[]) =>
    calls.map((call) => call.sql.trim().split(/\s+/).slice(0, 4).join(' '));
  const reads = [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text,",
    'SELECT id FROM bank_deposits',
    'SELECT id, kind, name,',
    'SELECT "depositId", to_char("effectiveFrom", \'YYYY-MM-DD\')',
    'SELECT id, "depositId", to_char("occurredOn",',
    'SELECT id, "depositId", to_char("checkedOn",',
  ];

  it('DEP-RATE a new rate inside the term is saved with its History event', async () => {
    const { outcome, calls } = await addRate(stored(), {
      effectiveFrom: '2026-03-01',
      ratePercent: '13',
    });
    expect(outcome).toEqual({ value: 'read back' });
    expect(kinds(calls)).toEqual([
      ...reads,
      'INSERT INTO bank_deposit_rates ("ownerId",',
      'INSERT INTO bank_deposit_events (id,',
    ]);
    expect(calls[6].parameters).toEqual([owner, depositId, '2026-03-01', '13']);
    expect(calls[7].parameters.slice(1)).toEqual([
      owner,
      depositId,
      'rate-added',
      '2026-03-01',
      null,
      null,
      '13',
      null,
      null,
    ]);
  });

  it('DEP-RATE a retry of the same rate writes no History event', async () => {
    const { outcome, calls } = await addRate(
      stored(),
      { effectiveFrom: '2026-03-01', ratePercent: '13' },
      false,
    );
    expect(outcome).toEqual({ value: 'read back' });
    expect(kinds(calls)).toEqual([...reads, 'INSERT INTO bank_deposit_rates ("ownerId",']);
  });

  it('DEP-RATE a future date is refused before the term is checked', async () => {
    const { outcome, calls } = await addRate(stored(), {
      effectiveFrom: '2026-09-01',
      ratePercent: '13',
    });
    expect(outcome).toEqual(
      refused('UnprocessableEntityException', 'The rate change date is in the future'),
    );
    expect(kinds(calls)).toEqual(reads);
  });

  it('DEP-RATE a term deposit takes no change on its first day, after its end or after closing', async () => {
    const inside = refused('UnprocessableEntityException', 'The rate must change inside the term');
    expect(
      (await addRate(stored(), { effectiveFrom: '2026-01-01', ratePercent: '13' })).outcome,
    ).toEqual(inside);
    const ended = stored({ deposit: { endDate: '2026-05-01' } });
    expect(
      (await addRate(ended, { effectiveFrom: '2026-05-01', ratePercent: '13' })).outcome,
    ).toEqual(inside);
    const emptied = stored({
      movements: [
        movement('2026-01-01', 'topup', '100000.00'),
        movement('2026-02-15', 'withdrawal', '100000.00'),
      ],
    });
    expect(
      (await addRate(emptied, { effectiveFrom: '2026-02-15', ratePercent: '13' })).outcome,
    ).toEqual(refused('UnprocessableEntityException', 'The deposit was closed before that date'));
    expect(
      (await addRate(emptied, { effectiveFrom: '2026-02-14', ratePercent: '13' })).outcome,
    ).toEqual({ value: 'read back' });
  });

  it('DEP-ACCOUNT an account without an opening rate may take one from its opening day only', async () => {
    const account = stored({
      deposit: { kind: 'account', endDate: null },
      rates: [rate('2026-02-01', '9')],
    });
    expect(
      (await addRate(account, { effectiveFrom: '2026-01-01', ratePercent: '8' })).outcome,
    ).toEqual({ value: 'read back' });
    expect(
      (await addRate(account, { effectiveFrom: '2025-12-31', ratePercent: '8' })).outcome,
    ).toEqual(refused('UnprocessableEntityException', 'The rate must change inside the term'));
    const opened = stored({
      deposit: { kind: 'account', endDate: null },
      rates: [rate('2026-01-01', '9')],
    });
    expect(
      (await addRate(opened, { effectiveFrom: '2026-01-01', ratePercent: '8' })).outcome,
    ).toEqual(refused('UnprocessableEntityException', 'The rate must change inside the term'));
  });

  it('DEP-RATE a change that would undo a recorded payout of interest conflicts', async () => {
    const paid = stored({
      movements: [
        movement('2026-01-01', 'topup', '100000.00'),
        movement('2026-02-01', 'interest-payout', '1000.00'),
      ],
    });
    const { outcome, calls } = await addRate(paid, {
      effectiveFrom: '2026-01-02',
      ratePercent: '0',
    });
    expect(outcome).toEqual(
      refused('ConflictException', 'A recorded movement depends on the earlier rate'),
    );
    expect(kinds(calls)).toEqual(reads);
  });
});
