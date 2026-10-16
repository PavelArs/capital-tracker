import type { EntityManager } from 'typeorm';
import type { DepositKind } from './deposit-input';
import type { DepositCurrency, DepositMovement, DepositTerms } from './deposit-interest';

export interface DepositRow {
  id: string;
  kind: DepositKind;
  name: string;
  bank: string;
  currency: DepositCurrency;
  startDate: string;
  endDate: string | null;
  payout: DepositTerms['payout'];
  capitalized: boolean;
  dayBasis: DepositTerms['dayBasis'];
  earlyClose: DepositTerms['earlyClose'];
}
export interface RateRow {
  depositId: string;
  effectiveFrom: string;
  ratePercent: string;
}
export interface MovementRow {
  id: string;
  depositId: string;
  occurredOn: string;
  kind: DepositMovement['kind'];
  amount: string;
  comment: string | null;
}
export interface CheckRow {
  id: string;
  depositId: string;
  checkedOn: string;
  bankBalance: string;
}
export interface Stored {
  deposit: DepositRow;
  rates: RateRow[];
  movements: MovementRow[];
  checks: CheckRow[];
}

const columns = `id, kind, name, bank, currency, to_char("startDate", 'YYYY-MM-DD') AS "startDate",
  to_char("endDate", 'YYYY-MM-DD') AS "endDate", payout, capitalized, "dayBasis", "earlyClose"`;

export const termsOf = (stored: Stored): DepositTerms => ({
  kind: stored.deposit.kind,
  startDate: stored.deposit.startDate,
  endDate: stored.deposit.endDate,
  payout: stored.deposit.payout,
  capitalized: stored.deposit.capitalized,
  dayBasis: stored.deposit.dayBasis,
  earlyClose: stored.deposit.earlyClose,
  rates: stored.rates.map((rate) => ({
    effectiveFrom: rate.effectiveFrom,
    ratePercent: rate.ratePercent,
  })),
});
export const movementsOf = (stored: Stored): DepositMovement[] =>
  stored.movements.map((row) => ({ date: row.occurredOn, kind: row.kind, amount: row.amount }));

const ratePercentText = (value: string) => {
  const [whole, fraction = ''] = value.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
};

/** The owner's deposits (or one) with their rates, movements and checks, oldest start first. */
export async function loadDeposits(
  manager: EntityManager,
  owner: string,
  id?: string,
): Promise<Stored[]> {
  const filter = id ? 'AND id=$2' : '';
  const args = id ? [owner, id] : [owner];
  const deposits: DepositRow[] = await manager.query(
    `SELECT ${columns} FROM bank_deposits WHERE "ownerId"=$1 ${filter} ORDER BY "startDate", "createdAt", id`,
    args,
  );
  if (deposits.length === 0) return [];
  const ids = deposits.map((row) => row.id);
  const rates: RateRow[] = await manager.query(
    `SELECT "depositId", to_char("effectiveFrom", 'YYYY-MM-DD') AS "effectiveFrom", "ratePercent"::text AS "ratePercent"
     FROM bank_deposit_rates WHERE "ownerId"=$1 AND "depositId" = ANY($2) ORDER BY "effectiveFrom"`,
    [owner, ids],
  );
  const movements: MovementRow[] = await manager.query(
    `SELECT id, "depositId", to_char("occurredOn", 'YYYY-MM-DD') AS "occurredOn", kind, amount::text AS amount, comment
     FROM bank_deposit_movements WHERE "ownerId"=$1 AND "depositId" = ANY($2)
     ORDER BY "occurredOn", "position"`,
    [owner, ids],
  );
  const checks: CheckRow[] = await manager.query(
    `SELECT id, "depositId", to_char("checkedOn", 'YYYY-MM-DD') AS "checkedOn", "bankBalance"::text AS "bankBalance"
     FROM bank_deposit_checks WHERE "ownerId"=$1 AND "depositId" = ANY($2)
     ORDER BY "checkedOn", "position"`,
    [owner, ids],
  );
  return deposits.map((deposit) => ({
    deposit,
    rates: rates
      .filter((row) => row.depositId === deposit.id)
      .map((row) => ({ ...row, ratePercent: ratePercentText(row.ratePercent) })),
    movements: movements.filter((row) => row.depositId === deposit.id),
    checks: checks.filter((row) => row.depositId === deposit.id),
  }));
}
