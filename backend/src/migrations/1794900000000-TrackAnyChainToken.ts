import { MigrationInterface, QueryRunner } from 'typeorm';

export class TrackAnyChainToken1794900000000 implements MigrationInterface {
  name = 'TrackAnyChainToken1794900000000';

  async up(runner: QueryRunner): Promise<void> {
    // TOKEN-ANY (M25): every ERC-20 and SPL token an Ethereum or Solana wallet moves, beyond
    // USDT and USDC. What the chain says about a token: its symbol, name and decimals, and the
    // ticker the portfolio names it by, unique so that a token copying another's symbol never
    // shares its asset. The CoinGecko listing is filled in when the token is priced. The
    // application validates the values, so no CHECK is added that a restore could reword.
    await runner.query(`CREATE TABLE chain_tokens (
      network text NOT NULL,
      contract text NOT NULL,
      symbol text NOT NULL,
      name text NOT NULL,
      decimals integer NOT NULL,
      ticker varchar(16) NOT NULL UNIQUE,
      "coingeckoId" text,
      "priceCheckedAt" timestamptz(3),
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (network, contract)
    )`);
    // A leg of such a token names it by its contract (Ethereum, lower case) or mint (Solana);
    // USDT and USDC legs keep their ticker.
    await runner.query(
      'ALTER TABLE wallet_address_transactions ALTER COLUMN asset TYPE varchar(64)',
    );
    // TOKEN-BACKFILL: the history an address had stored before other tokens were read is read
    // again for them, up to the block (Ethereum) or slot (Solana) it reached; "tokenBackfillAt"
    // is how far that reading got. Both are null once nothing is left to read.
    await runner.query(`ALTER TABLE wallet_addresses
      ADD COLUMN "tokenBackfillTo" integer,
      ADD COLUMN "tokenBackfillAt" integer`);
    await runner.query(`UPDATE wallet_addresses SET "tokenBackfillTo" = "scannedBlock"
      WHERE network IN ('ethereum', 'solana') AND "scannedBlock" IS NOT NULL`);
  }

  async down(): Promise<void> {
    throw new Error('Chain token downgrade requires an explicit recovery plan');
  }
}
