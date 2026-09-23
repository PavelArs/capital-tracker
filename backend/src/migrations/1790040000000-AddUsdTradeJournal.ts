import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUsdTradeJournal1790040000000 implements MigrationInterface {
  name = 'AddUsdTradeJournal1790040000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE account_trade_journals (
      "ownerId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      "accountId" uuid NOT NULL,
      "requestId" uuid NOT NULL,
      "canonicalPayload" text NOT NULL,
      "originKind" text NOT NULL CHECK ("originKind" = 'declared-empty'),
      "coverageFrom" timestamptz(3) NOT NULL CHECK (isfinite("coverageFrom")
        AND "coverageFrom" >= timestamptz '1970-01-01 00:00:00+00'
        AND "coverageFrom" < timestamptz '10000-01-01 00:00:00+00'),
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("createdAt")),
      "currentRevision" integer NOT NULL DEFAULT 0 CHECK ("currentRevision" BETWEEN 0 AND 10000),
      PRIMARY KEY ("ownerId", "accountId"),
      UNIQUE ("ownerId", "accountId", "requestId"),
      FOREIGN KEY ("ownerId", "accountId") REFERENCES manual_accounts ("ownerId", id) ON DELETE RESTRICT
    )`);
    await runner.query(`CREATE TABLE account_trades (
      id uuid PRIMARY KEY,
      "ownerId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      "accountId" uuid NOT NULL,
      "currentVersion" integer NOT NULL CHECK ("currentVersion" BETWEEN 1 AND 10000),
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("createdAt")),
      UNIQUE ("ownerId", "accountId", id),
      FOREIGN KEY ("ownerId", "accountId")
        REFERENCES account_trade_journals ("ownerId", "accountId") ON DELETE RESTRICT
    )`);
    await runner.query(`CREATE TABLE account_trade_versions (
      "ownerId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      "accountId" uuid NOT NULL,
      "tradeId" uuid NOT NULL,
      version integer NOT NULL CHECK (version BETWEEN 1 AND 10000),
      "journalRevision" integer NOT NULL CHECK ("journalRevision" BETWEEN 1 AND 10000),
      "requestId" uuid NOT NULL,
      "canonicalPayload" text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('create', 'correct', 'void')),
      "instrumentId" uuid NOT NULL,
      side text NOT NULL CHECK (side IN ('buy', 'sell')),
      "occurredAt" timestamptz(3) NOT NULL CHECK (isfinite("occurredAt")
        AND "occurredAt" >= timestamptz '1970-01-01 00:00:00+00'
        AND "occurredAt" < timestamptz '10000-01-01 00:00:00+00'),
      "orderWithinTimestamp" integer NOT NULL CHECK ("orderWithinTimestamp" >= 0),
      quantity numeric(78,30) NOT NULL CHECK (quantity > 0
        AND quantity NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
      "grossUsd" numeric(78,30) NOT NULL CHECK ("grossUsd" > 0
        AND "grossUsd" NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
      "feeUsd" numeric(78,30) NOT NULL CHECK ("feeUsd" >= 0
        AND "feeUsd" NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("createdAt")),
      PRIMARY KEY ("ownerId", "accountId", "tradeId", version),
      UNIQUE ("ownerId", "accountId", "requestId"),
      UNIQUE ("ownerId", "accountId", "journalRevision"),
      FOREIGN KEY ("ownerId", "accountId", "tradeId")
        REFERENCES account_trades ("ownerId", "accountId", id) ON DELETE RESTRICT,
      FOREIGN KEY ("ownerId", "instrumentId")
        REFERENCES accounting_instruments ("ownerId", id) ON DELETE RESTRICT
    )`);
    // The identity and its first complete immutable version commit together.
    // Defer only this insert cycle; no committed head may lack its own version.
    await runner.query(`ALTER TABLE account_trades
      ADD CONSTRAINT account_trades_current_version
      FOREIGN KEY ("ownerId", "accountId", id, "currentVersion")
      REFERENCES account_trade_versions ("ownerId", "accountId", "tradeId", version)
      ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED`);
  }

  async down(): Promise<void> {
    throw new Error('Trade journal downgrade requires an explicit recovery plan');
  }
}
