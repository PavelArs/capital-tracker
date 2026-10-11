import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBankDeposits1796500000000 implements MigrationInterface {
  name = 'AddBankDeposits1796500000000';

  async up(runner: QueryRunner): Promise<void> {
    // DEP-TERMS: a bank deposit as the owner enters it once. Interest earned is computed from
    // these rows and never stored; the rows only hold what the owner told the app.
    await runner.query(`CREATE TABLE bank_deposits (
      id uuid PRIMARY KEY,
      "ownerId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      name varchar(120) NOT NULL CHECK (btrim(name) <> ''),
      bank varchar(120) NOT NULL CHECK (btrim(bank) <> ''),
      currency text NOT NULL CHECK (currency IN ('RUB', 'USD', 'EUR')),
      "startDate" date NOT NULL,
      "endDate" date CHECK ("endDate" > "startDate"),
      payout text NOT NULL CHECK (payout IN ('monthly', 'quarterly', 'at-end')),
      capitalized boolean NOT NULL,
      "dayBasis" text NOT NULL CHECK ("dayBasis" IN ('actual-365', 'actual-actual')),
      "earlyClose" text NOT NULL CHECK ("earlyClose" IN ('forfeits-interest', 'keeps-interest')),
      "createdAt" timestamptz(3) NOT NULL DEFAULT now(),
      UNIQUE ("ownerId", id),
      CHECK (payout <> 'at-end' OR "endDate" IS NOT NULL)
    )`);
    // The annual rate in percent from a date on; the bank may change it during the term.
    await runner.query(`CREATE TABLE bank_deposit_rates (
      "ownerId" uuid NOT NULL,
      "depositId" uuid NOT NULL,
      "effectiveFrom" date NOT NULL,
      "ratePercent" numeric(9, 4) NOT NULL CHECK ("ratePercent" >= 0 AND "ratePercent" < 1000),
      PRIMARY KEY ("depositId", "effectiveFrom"),
      FOREIGN KEY ("ownerId", "depositId")
        REFERENCES bank_deposits ("ownerId", id) ON DELETE CASCADE
    )`);
    // Money put in, taken out, and interest paid out to the owner, dated by the bank.
    await runner.query(`CREATE TABLE bank_deposit_movements (
      id uuid PRIMARY KEY,
      "ownerId" uuid NOT NULL,
      "depositId" uuid NOT NULL,
      "occurredOn" date NOT NULL,
      kind text NOT NULL CHECK (kind IN ('topup', 'withdrawal', 'interest-payout')),
      amount numeric(30, 2) NOT NULL CHECK (amount > 0),
      comment varchar(200),
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
      -- The order the movements were entered in (the service numbers them under the deposit's
      -- lock); the same-day order is replayed by it.
      "position" integer NOT NULL,
      UNIQUE ("depositId", "position"),
      FOREIGN KEY ("ownerId", "depositId")
        REFERENCES bank_deposits ("ownerId", id) ON DELETE CASCADE
    )`);
    await runner.query(
      `CREATE INDEX bank_deposit_movements_deposit ON bank_deposit_movements ("depositId", "occurredOn", "position")`,
    );
    // DEP-CHECK: the balance the owner read in the bank's own app on a day, kept to compare
    // with what the app computes for that day.
    await runner.query(`CREATE TABLE bank_deposit_checks (
      id uuid PRIMARY KEY,
      "ownerId" uuid NOT NULL,
      "depositId" uuid NOT NULL,
      "checkedOn" date NOT NULL,
      "bankBalance" numeric(30, 2) NOT NULL CHECK ("bankBalance" >= 0),
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY ("ownerId", "depositId")
        REFERENCES bank_deposits ("ownerId", id) ON DELETE CASCADE
    )`);
    await runner.query(
      `CREATE INDEX bank_deposit_checks_deposit ON bank_deposit_checks ("depositId", "checkedOn", "createdAt")`,
    );
  }

  async down(): Promise<void> {
    throw new Error('Bank deposits downgrade requires an explicit recovery plan');
  }
}
