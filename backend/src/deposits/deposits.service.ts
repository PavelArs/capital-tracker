import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { canonicalDecimalToAtoms } from '../accounting/money';
import { type AccountingCurrency, FxConverter, moscowDate } from '../fx-rates/fx-conversion';
import { readFxRates } from '../fx-rates/fx-rates.service';
import { readEffectiveChanges, readPersonalRate } from '../inflation/inflation.service';
import { buildSeries } from '../inflation/inflation-math';
import { recordDepositEvent } from './deposit-events';
import {
  parseAsOfDate,
  parseCheck,
  parseDeposit,
  parseDepositPreview,
  parseMovement,
  parseRateChange,
  parseUuid,
} from './deposit-input';
import {
  bankBalanceOf,
  centsText,
  type DepositCurrency,
  type DepositMovement,
  type DepositTerms,
  depositBalances,
  firstImpossibleMovement,
  nextPayout,
  payoutSchedules,
  previewDeposit,
  projectDeposit,
} from './deposit-interest';
import {
  chartDates,
  depositChart,
  depositReal,
  type InflationReadings,
  inflationReadings,
  inTodaysMoney,
  periodsAfterInflation,
} from './deposit-real';
import {
  interestMissing as accountInterestMissing,
  loadDeposits,
  movementsOf,
  noRateInForceOn,
  type Stored,
  termsOf,
} from './deposit-store';
import { ratesAreFresh } from './deposit-valuation';

const accountingCurrencies: readonly AccountingCurrency[] = ['USD', 'EUR', 'RUB'];

/**
 * DEP-ACCRUAL, DEP-CHECK: bank deposits the owner entered once. What a deposit has earned and
 * what it is worth are computed from its terms and movements on every read.
 */
@Injectable()
export class DepositsService {
  constructor(private readonly source: DataSource) {}

  async list(ownerId: string, rawAsOf: unknown) {
    const owner = parseUuid(ownerId);
    const asOf = parseAsOfDate(rawAsOf);
    return this.read(async (manager) => {
      const today = moscowDate(new Date());
      if (asOf !== undefined && asOf > latestSnapshot(today))
        throw new UnprocessableEntityException('The date is too far in the future');
      const date = asOf ?? today;
      const all = await loadDeposits(manager, owner);
      const converters = await this.converters(manager);
      // A deposit that has not started by the asked day is not part of that day's picture.
      const started = all.filter((stored) => stored.deposit.startDate <= date);
      const readings = await this.inflation(manager, owner, started);
      const items = started.map((stored) =>
        this.view(stored, date, converters, readings.get(stored.deposit.currency)),
      );
      // A closed deposit still counts while interest posted before the closure is unpaid.
      const open = items.filter(
        (item) => item.status !== 'closed' || canonicalDecimalToAtoms(item.balance) > 0n,
      );
      return {
        asOf: date,
        items,
        // Accounts holding money with no rate entered: the totals count what was put in only.
        interestMissingCount: open.filter(
          (item) => item.interestMissing && canonicalDecimalToAtoms(item.balance) > 0n,
        ).length,
        totals: Object.fromEntries(
          accountingCurrencies.map((currency) => {
            const values = open.map((item) => item.values[currency]);
            return [
              currency,
              values.some((value) => value === null)
                ? null
                : centsText(
                    values.reduce((sum, value) => sum + canonicalDecimalToAtoms(value ?? '0'), 0n),
                  ),
            ];
          }),
        ),
      };
    });
  }

  async get(ownerId: string, id: string, rawAsOf: unknown) {
    const owner = parseUuid(ownerId);
    const depositId = parseUuid(id);
    const asOf = parseAsOfDate(rawAsOf);
    return this.read(async (manager) => {
      const [stored] = await loadDeposits(manager, owner, depositId);
      if (!stored) throw new NotFoundException('Deposit not found');
      const date = asOf ?? moscowDate(new Date());
      if (date > latestSnapshot(moscowDate(new Date())))
        throw new UnprocessableEntityException('The date is too far in the future');
      if (stored.deposit.startDate > date)
        throw new NotFoundException('The deposit had not started on that date');
      const readings = await this.inflation(manager, owner, [stored]);
      return this.detail(
        stored,
        date,
        await this.converters(manager),
        readings.get(stored.deposit.currency),
      );
    });
  }

  async create(ownerId: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    // A stored quarterly schedule is read as a retry of an earlier request only (below).
    const { requestId, ...input } = parseDeposit(raw, payoutSchedules);
    // A term deposit's payload is what it was before kinds, so a retry of an earlier request matches.
    const { kind: _kind, ...terms } = input;
    const payload = JSON.stringify(input.kind === 'account' ? input : terms);
    if (input.startDate > moscowDate(new Date()))
      throw new UnprocessableEntityException('Start date is in the future');
    const id = await this.source.transaction(async (manager) => {
      const created: { id: string }[] = await manager.query(
        `INSERT INTO bank_deposits (id, "ownerId", "requestId", "canonicalPayload", name, bank, currency,
           "startDate", "endDate", payout, capitalized, "dayBasis", "earlyClose", kind)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT ("ownerId", "requestId") DO NOTHING
         RETURNING id`,
        [
          randomUUID(),
          owner,
          requestId,
          payload,
          input.name,
          input.bank,
          input.currency,
          input.startDate,
          input.endDate,
          input.payout,
          input.capitalized,
          input.dayBasis,
          input.earlyClose,
          input.kind,
        ],
      );
      if (created.length === 0) {
        // The same request again, e.g. a retry after a lost answer: the deposit it made.
        const [earlier]: { id: string; canonicalPayload: string }[] = await manager.query(
          'SELECT id, "canonicalPayload" FROM bank_deposits WHERE "ownerId"=$1 AND "requestId"=$2',
          [owner, requestId],
        );
        if (earlier.canonicalPayload !== payload)
          throw new ConflictException('This request was already used for a different deposit');
        return earlier.id;
      }
      // Quarterly is no longer offered: it is accepted only as the retry of a deposit made before.
      if (input.payout === 'quarterly') throw new BadRequestException('Invalid deposit input');
      const depositId = created[0].id;
      // An account entered without a rate has no rate: it earns nothing, and its figures show 0.
      if (input.ratePercent !== null)
        await manager.query(
          'INSERT INTO bank_deposit_rates ("ownerId", "depositId", "effectiveFrom", "ratePercent") VALUES ($1,$2,$3,$4)',
          [owner, depositId, input.startDate, input.ratePercent],
        );
      await manager.query(
        `INSERT INTO bank_deposit_movements (id, "ownerId", "depositId", "requestId", "canonicalPayload",
           "occurredOn", kind, amount, "position")
         VALUES ($1,$2,$3,$4,'opening',$5,'topup',$6,1)`,
        [randomUUID(), owner, depositId, randomUUID(), input.startDate, input.amount],
      );
      await recordDepositEvent(manager, owner, depositId, 'opened', {
        occurredOn: input.startDate,
        amount: input.amount,
        ratePercent: input.ratePercent,
      });
      return depositId;
    });
    return this.get(owner, id, undefined);
  }

  /**
   * DEP-PREVIEW: what the deposit being entered would earn, from the same terms and the same
   * interest code as a saved one. Nothing is read or written.
   */
  preview(ownerId: string, raw: unknown) {
    parseUuid(ownerId);
    const input = parseDepositPreview(raw);
    if (input.startDate > moscowDate(new Date()))
      throw new UnprocessableEntityException('Start date is in the future');
    // A new deposit has one rate from its start, as adding it stores.
    const terms: DepositTerms = {
      startDate: input.startDate,
      endDate: input.endDate,
      payout: input.payout,
      capitalized: input.capitalized,
      dayBasis: input.dayBasis,
      earlyClose: input.earlyClose,
      rates:
        input.ratePercent === null
          ? []
          : [{ effectiveFrom: input.startDate, ratePercent: input.ratePercent }],
    };
    return previewDeposit(terms, input.amount);
  }

  async addMovement(ownerId: string, id: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const depositId = parseUuid(id);
    const { requestId, ...input } = parseMovement(raw);
    const payload = JSON.stringify({ depositId, ...input });
    if (input.date > moscowDate(new Date()))
      throw new UnprocessableEntityException('Date is in the future');
    await this.source.transaction(async (manager) => {
      const stored = await this.locked(manager, owner, depositId);
      const [earlier]: { canonicalPayload: string }[] = await manager.query(
        'SELECT "canonicalPayload" FROM bank_deposit_movements WHERE "ownerId"=$1 AND "requestId"=$2',
        [owner, requestId],
      );
      if (earlier) {
        // The same request again, e.g. a retry after a lost answer: already recorded.
        if (earlier.canonicalPayload !== payload)
          throw new ConflictException('This request was already used for a different movement');
        return;
      }
      // A movement goes after the ones already recorded for its day, as the database orders them.
      const next = stableByDate([
        ...movementsOf(stored),
        { date: input.date, kind: input.kind, amount: input.amount },
      ]);
      if (firstImpossibleMovement(termsOf(stored), next) !== -1)
        throw new UnprocessableEntityException('The deposit could not have had this movement');
      await manager.query(
        `INSERT INTO bank_deposit_movements (id, "ownerId", "depositId", "requestId", "canonicalPayload",
           "occurredOn", kind, amount, comment, "position")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
           (SELECT coalesce(max("position"), 0) + 1 FROM bank_deposit_movements WHERE "depositId"=$3))`,
        [
          randomUUID(),
          owner,
          depositId,
          requestId,
          payload,
          input.date,
          input.kind,
          input.amount,
          input.comment,
        ],
      );
      await recordDepositEvent(manager, owner, depositId, 'movement-added', {
        occurredOn: input.date,
        movementKind: input.kind,
        amount: input.amount,
        comment: input.comment,
      });
    });
    return this.get(owner, depositId, undefined);
  }

  async removeMovement(ownerId: string, id: string, movementId: string) {
    const owner = parseUuid(ownerId);
    const depositId = parseUuid(id);
    const moveId = parseUuid(movementId);
    await this.source.transaction(async (manager) => {
      const stored = await this.locked(manager, owner, depositId);
      const index = stored.movements.findIndex((row) => row.id === moveId);
      if (index === -1) throw new NotFoundException('Movement not found');
      const remaining = movementsOf(stored).filter((_, position) => position !== index);
      if (
        index === 0 &&
        stored.movements[0].occurredOn === stored.deposit.startDate &&
        stored.movements[0].kind === 'topup'
      )
        throw new UnprocessableEntityException(
          'The first deposit cannot be removed; delete the deposit instead',
        );
      if (firstImpossibleMovement(termsOf(stored), remaining) !== -1)
        throw new ConflictException('A later movement depends on this one');
      await manager.query('DELETE FROM bank_deposit_movements WHERE "ownerId"=$1 AND id=$2', [
        owner,
        moveId,
      ]);
      const gone = stored.movements[index];
      await recordDepositEvent(manager, owner, depositId, 'movement-removed', {
        occurredOn: gone.occurredOn,
        movementKind: gone.kind,
        amount: gone.amount,
        comment: gone.comment,
      });
    });
    return this.get(owner, depositId, undefined);
  }

  async addRate(ownerId: string, id: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const depositId = parseUuid(id);
    const input = parseRateChange(raw);
    await this.source.transaction(async (manager) => {
      const stored = await this.locked(manager, owner, depositId);
      if (input.effectiveFrom > moscowDate(new Date()))
        throw new UnprocessableEntityException('The rate change date is in the future');
      // A term deposit opens with its rate; an account entered without one may be given its first
      // rate from its opening day, so that day's interest is not lost.
      const firstRateOfAccount =
        stored.deposit.kind === 'account' &&
        !stored.rates.some((rate) => rate.effectiveFrom === stored.deposit.startDate);
      if (
        (firstRateOfAccount
          ? input.effectiveFrom < stored.deposit.startDate
          : input.effectiveFrom <= stored.deposit.startDate) ||
        (stored.deposit.endDate !== null && input.effectiveFrom >= stored.deposit.endDate)
      )
        throw new UnprocessableEntityException('The rate must change inside the term');
      const next: DepositTerms = {
        ...termsOf(stored),
        rates: [
          ...stored.rates.filter((rate) => rate.effectiveFrom !== input.effectiveFrom),
          input,
        ].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1)),
      };
      const closedOn = projectDeposit(
        termsOf(stored),
        movementsOf(stored),
        stored.deposit.endDate ?? moscowDate(new Date()),
      ).closedOn;
      if (closedOn !== null && input.effectiveFrom >= closedOn)
        throw new UnprocessableEntityException('The deposit was closed before that date');
      if (firstImpossibleMovement(next, movementsOf(stored)) !== -1)
        throw new ConflictException('A recorded movement depends on the earlier rate');
      await manager.query(
        `INSERT INTO bank_deposit_rates ("ownerId", "depositId", "effectiveFrom", "ratePercent")
         VALUES ($1,$2,$3,$4)
         ON CONFLICT ("depositId", "effectiveFrom") DO UPDATE SET "ratePercent" = EXCLUDED."ratePercent"`,
        [owner, depositId, input.effectiveFrom, input.ratePercent],
      );
      await recordDepositEvent(manager, owner, depositId, 'rate-added', {
        occurredOn: input.effectiveFrom,
        ratePercent: input.ratePercent,
      });
    });
    return this.get(owner, depositId, undefined);
  }

  async addCheck(ownerId: string, id: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const depositId = parseUuid(id);
    const { requestId, ...input } = parseCheck(raw);
    const payload = JSON.stringify({ depositId, ...input });
    if (input.checkedOn > moscowDate(new Date()))
      throw new UnprocessableEntityException('Date is in the future');
    await this.source.transaction(async (manager) => {
      const stored = await this.locked(manager, owner, depositId);
      if (input.checkedOn < stored.deposit.startDate)
        throw new UnprocessableEntityException('The date is before the deposit started');
      const [earlier]: { canonicalPayload: string }[] = await manager.query(
        'SELECT "canonicalPayload" FROM bank_deposit_checks WHERE "ownerId"=$1 AND "requestId"=$2',
        [owner, requestId],
      );
      if (earlier) {
        // The same request again, e.g. a retry after a lost answer: already recorded.
        if (earlier.canonicalPayload !== payload)
          throw new ConflictException('This request was already used for a different check');
        return;
      }
      await manager.query(
        `INSERT INTO bank_deposit_checks (id, "ownerId", "depositId", "requestId", "canonicalPayload",
           "checkedOn", "bankBalance", "position")
         VALUES ($1,$2,$3,$4,$5,$6,$7,
           (SELECT coalesce(max("position"), 0) + 1 FROM bank_deposit_checks WHERE "depositId"=$3))`,
        [randomUUID(), owner, depositId, requestId, payload, input.checkedOn, input.bankBalance],
      );
      await recordDepositEvent(manager, owner, depositId, 'check-added', {
        occurredOn: input.checkedOn,
        bankBalance: input.bankBalance,
      });
    });
    return this.get(owner, depositId, undefined);
  }

  async remove(ownerId: string, id: string) {
    const owner = parseUuid(ownerId);
    const depositId = parseUuid(id);
    await this.source.transaction(async (manager) => {
      await this.locked(manager, owner, depositId);
      await recordDepositEvent(manager, owner, depositId, 'deleted');
      await manager.query('DELETE FROM bank_deposits WHERE "ownerId"=$1 AND id=$2', [
        owner,
        depositId,
      ]);
    });
    return { id: depositId, deleted: true };
  }

  private async converters(manager: EntityManager) {
    const rates = await readFxRates(manager);
    return new Map(
      accountingCurrencies.map((currency) => [currency, new FxConverter(rates, currency)]),
    );
  }

  /** How inflation reads for each currency the deposits are in: the official and the own rate. */
  private async inflation(manager: EntityManager, owner: string, deposits: readonly Stored[]) {
    const readings = new Map<DepositCurrency, InflationReadings>();
    for (const { deposit } of deposits) {
      if (readings.has(deposit.currency)) continue;
      const { changes } = await readEffectiveChanges(manager, owner, deposit.currency);
      readings.set(
        deposit.currency,
        inflationReadings(
          buildSeries(changes),
          await readPersonalRate(manager, owner, deposit.currency),
        ),
      );
    }
    return readings;
  }

  private read<T>(action: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      return action(manager);
    });
  }

  private async locked(manager: EntityManager, owner: string, id: string): Promise<Stored> {
    const found: { id: string }[] = await manager.query(
      'SELECT id FROM bank_deposits WHERE "ownerId"=$1 AND id=$2 FOR UPDATE',
      [owner, id],
    );
    if (found.length === 0) throw new NotFoundException('Deposit not found');
    return (await loadDeposits(manager, owner, id))[0];
  }

  /** The balance stated in each accounting currency at the Bank of Russia rate of that day. */
  private values(
    amount: string,
    currency: DepositCurrency,
    date: string,
    converters: Map<AccountingCurrency, FxConverter>,
  ) {
    const atoms = canonicalDecimalToAtoms(amount);
    return Object.fromEntries(
      accountingCurrencies.map((target) => {
        const converter = converters.get(target);
        // A stopped rate collection must not state a value at a weeks-old rate as today's.
        const converted =
          converter && (currency === target || ratesAreFresh(converter, [currency, target], date))
            ? converter.convert(atoms, currency, date)
            : null;
        return [target, converted === null ? null : centsText(converted)];
      }),
    ) as Record<AccountingCurrency, string | null>;
  }

  private view(
    stored: Stored,
    asOf: string,
    converters: Map<AccountingCurrency, FxConverter>,
    readings: InflationReadings | undefined,
  ) {
    const terms = termsOf(stored);
    const movements = movementsOf(stored);
    const now = projectDeposit(terms, movements, asOf);
    const ended = terms.endDate !== null && terms.endDate <= asOf;
    const status =
      now.closedOn !== null
        ? ('closed' as const)
        : ended
          ? ('matured' as const)
          : ('active' as const);
    // A snapshot forecasts from what was known on that day, not from movements saved since.
    const known = movements.filter((movement) => movement.date <= asOf);
    const knownTerms = {
      ...terms,
      rates: terms.rates.filter((rate) => rate.effectiveFrom <= asOf),
    };
    const maturity =
      terms.endDate !== null && now.closedOn === null
        ? projectDeposit(knownTerms, known, terms.endDate)
        : null;
    // Only checks made by the asked day: a later one says nothing about this day.
    const last = [...stored.checks].reverse().find((check) => check.checkedOn <= asOf);
    const lastCheck = last
      ? (() => {
          const calculated = bankBalanceOf(terms, projectDeposit(terms, movements, last.checkedOn));
          return {
            checkedOn: last.checkedOn,
            bankBalance: last.bankBalance,
            calculated,
            difference: centsText(
              canonicalDecimalToAtoms(last.bankBalance) - canonicalDecimalToAtoms(calculated),
            ),
          };
        })()
      : null;
    const inForce = [...terms.rates].reverse().find((rate) => rate.effectiveFrom <= asOf);
    // A term deposit read before its first rate still shows that rate; an account has none until
    // a rate takes effect, and a missing rate is not stated as 0%.
    const ratePercent =
      inForce?.ratePercent ??
      (stored.deposit.kind === 'account' ? null : (terms.rates[0]?.ratePercent ?? null));
    // Missing is not zero: the days of an account before its first rate have unknown interest,
    // and a day with no rate in force has none to state, so those figures are not stated.
    const interestMissing = accountInterestMissing(stored);
    const noRate = noRateInForceOn(stored, asOf);
    const afterInflation = (reading: InflationReadings['official'] | undefined) =>
      reading && !noRate
        ? depositReal(
            {
              balance: now.balance,
              active: status === 'active',
              ratePercent,
              terms,
              movements: known,
              asOf,
            },
            reading,
          )
        : null;
    return {
      id: stored.deposit.id,
      kind: stored.deposit.kind,
      name: stored.deposit.name,
      bank: stored.deposit.bank,
      currency: stored.deposit.currency,
      startDate: terms.startDate,
      endDate: terms.endDate,
      payout: terms.payout,
      capitalized: terms.capitalized,
      dayBasis: terms.dayBasis,
      earlyClose: terms.earlyClose,
      ratePercent,
      status,
      closedOn: now.closedOn,
      principal: now.principal,
      interestMissing,
      accrued: noRate ? null : now.accrued,
      due: noRate ? null : now.due,
      balance: now.balance,
      // Everything the deposit has earned, posted or not, less what was forfeited.
      interestEarned: noRate
        ? null
        : centsText(
            canonicalDecimalToAtoms(now.interestPosted) + canonicalDecimalToAtoms(now.accrued),
          ),
      real: {
        official: afterInflation(readings?.official),
        personal: afterInflation(readings?.personal),
      },
      values: this.values(now.balance, stored.deposit.currency, asOf, converters),
      nextPayout: status === 'active' && !noRate ? nextPayout(knownTerms, known, asOf) : null,
      atMaturity: maturity
        ? {
            date: terms.endDate as string,
            balance: maturity.balance,
            interest: centsText(canonicalDecimalToAtoms(maturity.interestPosted)),
            // The balance on the end date in the money of the day asked (null past the end).
            inTodaysMoney: readings
              ? inTodaysMoney(maturity.balance, asOf, terms.endDate as string, readings)
              : { official: null, personal: null },
          }
        : null,
      lastCheck,
    };
  }

  private detail(
    stored: Stored,
    asOf: string,
    converters: Map<AccountingCurrency, FxConverter>,
    readings: InflationReadings | undefined,
  ) {
    const terms = termsOf(stored);
    const projection = projectDeposit(terms, movementsOf(stored), asOf);
    // Without a rate there is no interest to list: the periods would all read 0.00 (DEP-ACCOUNT).
    const periods = noRateInForceOn(stored, asOf) ? [] : projection.periods;
    // One replay gives the money held at the start of every period.
    const held = depositBalances(
      terms,
      movementsOf(stored),
      periods.map((period) => period.from),
    );
    const official = readings && periodsAfterInflation(periods, held, readings.official);
    const personal = readings && periodsAfterInflation(periods, held, readings.personal);
    // The value by month from the start, each movement day and the day asked.
    const dates = chartDates(
      terms.startDate,
      asOf,
      movementsOf(stored).map((movement) => movement.date),
    );
    const chart = readings
      ? depositChart(
          dates,
          depositBalances(terms, movementsOf(stored), dates),
          movementsOf(stored),
          asOf,
          readings,
        )
      : [];
    return {
      ...this.view(stored, asOf, converters, readings),
      asOf,
      // Only what was on record by the asked day, so a past view shows no later activity.
      rates: stored.rates
        .filter((rate) => rate.effectiveFrom <= asOf)
        .map(({ effectiveFrom, ratePercent }) => ({ effectiveFrom, ratePercent })),
      movements: stored.movements
        .filter((row) => row.occurredOn <= asOf)
        .map((row) => ({
          id: row.id,
          date: row.occurredOn,
          kind: row.kind,
          amount: row.amount,
          comment: row.comment,
        })),
      chart,
      periods: periods.map((period, index) => ({
        ...period,
        afterInflation: {
          official: official?.[index] ?? null,
          personal: personal?.[index] ?? null,
        },
      })),
      interestPosted: projection.interestPosted,
      interestPaidOut: projection.interestPaidOut,
      interestForfeited: projection.interestForfeited,
      checks: stored.checks
        .filter((check) => check.checkedOn <= asOf)
        .map((check) => {
          const calculated = bankBalanceOf(
            terms,
            projectDeposit(terms, movementsOf(stored), check.checkedOn),
          );
          return {
            id: check.id,
            checkedOn: check.checkedOn,
            bankBalance: check.bankBalance,
            calculated,
            difference: centsText(
              canonicalDecimalToAtoms(check.bankBalance) - canonicalDecimalToAtoms(calculated),
            ),
          };
        })
        .reverse(),
    };
  }
}

/** A snapshot may look one year ahead; the figures are replayed day by day up to it. */
const latestSnapshot = (today: string) => `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;

/** Movements in date order, equal dates keeping the order they were given. */
function stableByDate(movements: DepositMovement[]): DepositMovement[] {
  return movements
    .map((movement, index) => ({ movement, index }))
    .sort((a, b) =>
      a.movement.date < b.movement.date
        ? -1
        : a.movement.date > b.movement.date
          ? 1
          : a.index - b.index,
    )
    .map(({ movement }) => movement);
}
