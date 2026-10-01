import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAssetRewards1790200000000 implements MigrationInterface {
  name = 'AddAssetRewards1790200000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE account_rewards (
      id uuid PRIMARY KEY,
      "ownerId" uuid NOT NULL,
      "accountId" uuid NOT NULL,
      "currentVersion" integer NOT NULL CHECK ("currentVersion" BETWEEN 1 AND 10000),
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("createdAt")),
      UNIQUE ("ownerId", "accountId", id),
      FOREIGN KEY ("ownerId", "accountId") REFERENCES account_trade_journals ("ownerId", "accountId") ON DELETE RESTRICT
    )`);
    await runner.query(`CREATE TABLE account_reward_versions (
      "ownerId" uuid NOT NULL,
      "accountId" uuid NOT NULL,
      "rewardId" uuid NOT NULL,
      version integer NOT NULL CHECK (version BETWEEN 1 AND 10000),
      "journalRevision" integer NOT NULL CHECK ("journalRevision" BETWEEN 1 AND 10000),
      "requestId" uuid NOT NULL,
      "canonicalPayload" text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('create','correct','void')),
      CHECK ((version=1)=(kind='create')),
      "instrumentId" uuid NOT NULL,
      category text NOT NULL CHECK (category IN ('staking','airdrop','other','unclassified')),
      "occurredAt" timestamptz(3) NOT NULL CHECK (isfinite("occurredAt")
        AND "occurredAt">=timestamptz '1970-01-01 00:00:00+00'
        AND "occurredAt"<timestamptz '10000-01-01 00:00:00+00'),
      "orderWithinTimestamp" integer NOT NULL CHECK ("orderWithinTimestamp">=0),
      quantity numeric(78,30) NOT NULL CHECK (quantity>0
        AND quantity NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
      "acquisitionBasisUsd" numeric(78,30) CHECK ("acquisitionBasisUsd">=0
        AND "acquisitionBasisUsd" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
      "incomeValueUsd" numeric(78,30) CHECK ("incomeValueUsd">=0
        AND "incomeValueUsd" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("createdAt")),
      PRIMARY KEY ("ownerId","accountId","rewardId",version),
      UNIQUE ("ownerId","accountId","requestId"),
      UNIQUE ("ownerId","accountId","journalRevision"),
      FOREIGN KEY ("ownerId","accountId","rewardId") REFERENCES account_rewards ("ownerId","accountId",id) ON DELETE RESTRICT,
      FOREIGN KEY ("ownerId","instrumentId") REFERENCES accounting_instruments ("ownerId",id) ON DELETE RESTRICT
    )`);
    await runner.query(`ALTER TABLE account_rewards ADD CONSTRAINT account_rewards_current_version
      FOREIGN KEY ("ownerId","accountId",id,"currentVersion")
      REFERENCES account_reward_versions ("ownerId","accountId","rewardId",version)
      ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED`);
  }

  async down(): Promise<void> {
    throw new Error('Asset reward downgrade requires an explicit recovery plan');
  }
}
