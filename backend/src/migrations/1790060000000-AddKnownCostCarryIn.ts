import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKnownCostCarryIn1790060000000 implements MigrationInterface {
  name = 'AddKnownCostCarryIn1790060000000';

  async up(runner: QueryRunner): Promise<void> {
    // Preserve every previous column value; old empty origins receive only NULL.
    await runner.query(`ALTER TABLE account_trade_journals
      ADD COLUMN "openingRevision" integer,
      DROP CONSTRAINT "account_trade_journals_originKind_check",
      ADD CONSTRAINT account_trade_journals_origin_check CHECK (
        ("originKind"='declared-empty' AND "openingRevision" IS NULL)
        OR ("originKind"='known-cost-carry-in' AND "openingRevision" IS NOT NULL
          AND "openingRevision">0)),
      ADD CONSTRAINT account_trade_journals_opening_key
        UNIQUE ("ownerId","accountId","openingRevision"),
      ADD CONSTRAINT account_trade_journals_opening_fk
        FOREIGN KEY ("ownerId","accountId","openingRevision")
        REFERENCES account_opening_snapshots ("ownerId","accountId",revision) ON DELETE RESTRICT`);
    await runner.query(`CREATE TABLE account_carry_in_lots (
      id uuid NOT NULL,
      "ownerId" uuid NOT NULL,
      "accountId" uuid NOT NULL,
      "openingRevision" integer NOT NULL,
      ordinal integer NOT NULL,
      "instrumentId" uuid NOT NULL,
      "acquiredAt" timestamptz(3) NOT NULL,
      "orderWithinTimestamp" integer NOT NULL,
      "originalQuantity" numeric(78,30) NOT NULL,
      "originalCostUsd" numeric(78,30) NOT NULL,
      "remainingQuantity" numeric(78,30) NOT NULL,
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT account_carry_in_lots_pkey PRIMARY KEY (id),
      CONSTRAINT account_carry_in_lots_identity_key UNIQUE ("ownerId","accountId",id),
      CONSTRAINT account_carry_in_lots_ordinal_key UNIQUE ("ownerId","accountId",ordinal),
      CONSTRAINT account_carry_in_lots_chronology_key
        UNIQUE ("ownerId","accountId","acquiredAt","orderWithinTimestamp"),
      CONSTRAINT account_carry_in_lots_owner_fk
        FOREIGN KEY ("ownerId") REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT account_carry_in_lots_journal_fk
        FOREIGN KEY ("ownerId","accountId","openingRevision")
        REFERENCES account_trade_journals ("ownerId","accountId","openingRevision") ON DELETE RESTRICT,
      CONSTRAINT account_carry_in_lots_position_fk
        FOREIGN KEY ("ownerId","accountId","openingRevision","instrumentId")
        REFERENCES account_opening_positions ("ownerId","accountId",revision,"instrumentId") ON DELETE RESTRICT,
      CONSTRAINT account_carry_in_lots_ordinal_check CHECK (ordinal BETWEEN 1 AND 100),
      CONSTRAINT account_carry_in_lots_opening_revision_check CHECK ("openingRevision">0),
      CONSTRAINT account_carry_in_lots_order_check CHECK ("orderWithinTimestamp">=0),
      CONSTRAINT account_carry_in_lots_quantities_check CHECK (
        "originalQuantity">0 AND "remainingQuantity">0 AND "remainingQuantity"<="originalQuantity"
        AND "originalQuantity" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
        AND "remainingQuantity" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
      CONSTRAINT account_carry_in_lots_cost_check CHECK ("originalCostUsd">=0
        AND "originalCostUsd" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
      CONSTRAINT account_carry_in_lots_acquired_at_check CHECK (isfinite("acquiredAt")
        AND "acquiredAt">=timestamptz '1970-01-01 00:00:00+00'
        AND "acquiredAt"<timestamptz '10000-01-01 00:00:00+00'),
      CONSTRAINT account_carry_in_lots_created_at_check CHECK (isfinite("createdAt"))
    )`);
  }

  async down(): Promise<void> {
    throw new Error('Carry-in downgrade requires an explicit recovery plan');
  }
}
