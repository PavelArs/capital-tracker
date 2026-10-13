import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSavingsGoals1797200000000 implements MigrationInterface {
  name = 'AddSavingsGoals1797200000000';

  async up(runner: QueryRunner): Promise<void> {
    // GOAL-TERMS: a savings goal as the owner enters it: a target sum for the whole portfolio,
    // with an optional deadline and the owner's own assumptions. Progress and forecasts are
    // computed from these rows and the portfolio on every read and never stored.
    await runner.query(`CREATE TABLE savings_goals (
      id uuid PRIMARY KEY,
      "ownerId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      "requestId" uuid NOT NULL,
      "canonicalPayload" text NOT NULL,
      name varchar(120) NOT NULL CHECK (btrim(name) <> ''),
      currency text NOT NULL CHECK (currency IN ('USD', 'EUR', 'RUB')),
      "targetAmount" numeric(30, 2) NOT NULL CHECK ("targetAmount" > 0),
      deadline date,
      -- The expected yearly return of the base case, in percent.
      "expectedReturnPercent" numeric(9, 4) NOT NULL
        CHECK ("expectedReturnPercent" >= 0 AND "expectedReturnPercent" < 1000),
      -- What the owner plans to add every month; empty when no plan was entered.
      "monthlyContribution" numeric(30, 2) CHECK ("monthlyContribution" >= 0),
      "createdAt" timestamptz(3) NOT NULL DEFAULT now(),
      "updatedAt" timestamptz(3) NOT NULL DEFAULT now(),
      UNIQUE ("ownerId", "requestId")
    )`);
    await runner.query('CREATE INDEX savings_goals_owner_idx ON savings_goals ("ownerId")');
  }

  async down(): Promise<void> {
    throw new Error('Savings goals downgrade requires an explicit recovery plan');
  }
}
