import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDepositEvents1797100000000 implements MigrationInterface {
  name = 'AddDepositEvents1797100000000';

  async up(runner: QueryRunner): Promise<void> {
    // DEP-HISTORY: what the owner did to a bank deposit, one row per action, kept for History.
    // A deposit's own rows are deleted with it, so this log has no foreign key to the deposit and
    // keeps what the deposit was called. Rows are only ever added.
    await runner.query(`CREATE TABLE bank_deposit_events (
      id uuid PRIMARY KEY,
      "ownerId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      "depositId" uuid NOT NULL,
      -- 1, 2, 3 ... per deposit, numbered under the deposit's lock.
      version integer NOT NULL CHECK (version >= 1),
      kind text NOT NULL CHECK (kind IN
        ('opened', 'movement-added', 'movement-removed', 'rate-added', 'check-added', 'deleted')),
      name varchar(120) NOT NULL,
      bank varchar(120) NOT NULL,
      currency text NOT NULL CHECK (currency IN ('RUB', 'USD', 'EUR')),
      -- The day the action is about: the movement, rate change or balance check; opened: the start.
      "occurredOn" date,
      "endDate" date,
      payout text CHECK (payout IN ('daily', 'monthly', 'quarterly', 'at-end')),
      "movementKind" text CHECK ("movementKind" IN ('topup', 'withdrawal', 'interest-payout')),
      amount numeric(30, 2) CHECK (amount > 0),
      "ratePercent" numeric(9, 4) CHECK ("ratePercent" >= 0 AND "ratePercent" < 1000),
      "bankBalance" numeric(30, 2) CHECK ("bankBalance" >= 0),
      comment varchar(200),
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
      UNIQUE ("ownerId", "depositId", version)
    )`);
    // Deposits and movements entered before this release: when they were entered is known.
    // Rate changes and balance checks of that time carry no entry time and are not listed.
    await runner.query(`INSERT INTO bank_deposit_events
        (id, "ownerId", "depositId", version, kind, name, bank, currency, "occurredOn", "endDate",
         payout, amount, "ratePercent", "createdAt")
      SELECT gen_random_uuid(), d."ownerId", d.id, 1, 'opened', d.name, d.bank, d.currency,
          d."startDate", d."endDate", d.payout,
          (SELECT m.amount FROM bank_deposit_movements m
            WHERE m."depositId" = d.id AND m."position" = 1),
          (SELECT r."ratePercent" FROM bank_deposit_rates r
            WHERE r."depositId" = d.id AND r."effectiveFrom" = d."startDate"),
          d."createdAt"
        FROM bank_deposits d`);
    await runner.query(`INSERT INTO bank_deposit_events
        (id, "ownerId", "depositId", version, kind, name, bank, currency, "occurredOn",
         "movementKind", amount, comment, "createdAt")
      SELECT gen_random_uuid(), m."ownerId", m."depositId",
          1 + row_number() OVER (PARTITION BY m."depositId" ORDER BY m."createdAt", m."position"),
          'movement-added', d.name, d.bank, d.currency, m."occurredOn", m.kind, m.amount,
          m.comment, m."createdAt"
        FROM bank_deposit_movements m
        JOIN bank_deposits d ON d."ownerId" = m."ownerId" AND d.id = m."depositId"
        WHERE m."position" > 1`);
  }

  async down(): Promise<void> {
    throw new Error('Deposit events downgrade requires an explicit recovery plan');
  }
}
