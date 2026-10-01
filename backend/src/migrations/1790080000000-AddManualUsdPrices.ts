import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddManualUsdPrices1790080000000 implements MigrationInterface {
  name = 'AddManualUsdPrices1790080000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE manual_usd_price_versions (
      "ownerId" uuid NOT NULL,
      "instrumentId" uuid NOT NULL,
      revision integer NOT NULL CHECK (revision BETWEEN 1 AND 10000),
      "requestId" uuid NOT NULL,
      "canonicalPayload" text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('set', 'void')),
      "observedAt" timestamptz(3) NOT NULL CHECK (isfinite("observedAt")
        AND "observedAt" >= timestamptz '1970-01-01 00:00:00+00'
        AND "observedAt" < timestamptz '10000-01-01 00:00:00+00'),
      "priceUsd" numeric(78,30),
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("createdAt")),
      PRIMARY KEY ("ownerId", "instrumentId", revision),
      UNIQUE ("ownerId", "instrumentId", "requestId"),
      FOREIGN KEY ("ownerId", "instrumentId")
        REFERENCES accounting_instruments ("ownerId", id) ON DELETE RESTRICT,
      CHECK ((kind = 'void' AND "priceUsd" IS NULL) OR
        (kind = 'set' AND "priceUsd" IS NOT NULL AND "priceUsd" >= 0
          AND "priceUsd" NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)))
    )`);
    await runner.query(`CREATE INDEX manual_usd_price_point_history
      ON manual_usd_price_versions ("ownerId", "instrumentId", "observedAt", revision DESC)`);
  }

  async down(): Promise<void> {
    throw new Error('Manual price downgrade requires an explicit recovery plan');
  }
}
