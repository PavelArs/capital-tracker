import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCurrencySystemAndPreferences1763741417438
  implements MigrationInterface
{
  name = "AddCurrencySystemAndPreferences1763741417438";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reports" DROP CONSTRAINT "FK_d9013193989303580053c0b5ef6_userId"`
    );
    await queryRunner.query(
      `ALTER TABLE "reports" DROP CONSTRAINT "FK_d9013193989303580053c0b5ef6_capitalId"`
    );
    await queryRunner.query(
      `ALTER TABLE "defi_positions" DROP CONSTRAINT "FK_a4955edb057ab1d7af8ac8aba10_userId"`
    );
    await queryRunner.query(
      `ALTER TABLE "broker_integrations" DROP CONSTRAINT "FK_94ce6ff27f93c2bd7ac77597dae_userId"`
    );
    await queryRunner.query(
      `ALTER TABLE "bank_integrations" DROP CONSTRAINT "FK_48d89e0dd7343c372749f4329d6_userId"`
    );
    await queryRunner.query(
      `ALTER TABLE "ai_recommendations" DROP CONSTRAINT "FK_57aa33b4356a91e94e98bcd3f2d_userId"`
    );
    await queryRunner.query(
      `CREATE TABLE "user_currency_preferences" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "currencyId" uuid NOT NULL, "isHidden" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_5d14524354a65ded83d3ce7b452" UNIQUE ("userId", "currencyId"), CONSTRAINT "PK_57632b1c141c417171ba299077d" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `ALTER TABLE "currencies" ADD "isSystem" boolean NOT NULL DEFAULT false`
    );

    // Помечаем базовые валюты как системные
    await queryRunner.query(`
            UPDATE "currencies" 
            SET "isSystem" = true 
            WHERE "code" IN ('USD', 'EUR', 'RUB', 'BTC', 'ETH', 'USDT')
        `);

    await queryRunner.query(
      `ALTER TABLE "reports" ADD CONSTRAINT "FK_bed415cd29716cd707e9cb3c09c" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "reports" ADD CONSTRAINT "FK_b4e8a7d2d3a4605b75615056f91" FOREIGN KEY ("capitalId") REFERENCES "capitals"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "defi_positions" ADD CONSTRAINT "FK_02028a4e70e3f66e59a8c74105a" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "broker_integrations" ADD CONSTRAINT "FK_4f36096ac4b1f71d313168e82a8" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "bank_integrations" ADD CONSTRAINT "FK_ff9fc9ca5d6b4025a4dc5007207" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "ai_recommendations" ADD CONSTRAINT "FK_a3957c679eb0304766c381d25e8" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "user_currency_preferences" ADD CONSTRAINT "FK_cb243d7440c54dd4a53560c4c32" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "user_currency_preferences" ADD CONSTRAINT "FK_07630774df422a1bd980d9dc4e1" FOREIGN KEY ("currencyId") REFERENCES "currencies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_currency_preferences" DROP CONSTRAINT "FK_07630774df422a1bd980d9dc4e1"`
    );
    await queryRunner.query(
      `ALTER TABLE "user_currency_preferences" DROP CONSTRAINT "FK_cb243d7440c54dd4a53560c4c32"`
    );
    await queryRunner.query(
      `ALTER TABLE "ai_recommendations" DROP CONSTRAINT "FK_a3957c679eb0304766c381d25e8"`
    );
    await queryRunner.query(
      `ALTER TABLE "bank_integrations" DROP CONSTRAINT "FK_ff9fc9ca5d6b4025a4dc5007207"`
    );
    await queryRunner.query(
      `ALTER TABLE "broker_integrations" DROP CONSTRAINT "FK_4f36096ac4b1f71d313168e82a8"`
    );
    await queryRunner.query(
      `ALTER TABLE "defi_positions" DROP CONSTRAINT "FK_02028a4e70e3f66e59a8c74105a"`
    );
    await queryRunner.query(
      `ALTER TABLE "reports" DROP CONSTRAINT "FK_b4e8a7d2d3a4605b75615056f91"`
    );
    await queryRunner.query(
      `ALTER TABLE "reports" DROP CONSTRAINT "FK_bed415cd29716cd707e9cb3c09c"`
    );
    await queryRunner.query(`ALTER TABLE "currencies" DROP COLUMN "isSystem"`);
    await queryRunner.query(`DROP TABLE "user_currency_preferences"`);
    await queryRunner.query(
      `ALTER TABLE "ai_recommendations" ADD CONSTRAINT "FK_57aa33b4356a91e94e98bcd3f2d_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "bank_integrations" ADD CONSTRAINT "FK_48d89e0dd7343c372749f4329d6_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "broker_integrations" ADD CONSTRAINT "FK_94ce6ff27f93c2bd7ac77597dae_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "defi_positions" ADD CONSTRAINT "FK_a4955edb057ab1d7af8ac8aba10_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "reports" ADD CONSTRAINT "FK_d9013193989303580053c0b5ef6_capitalId" FOREIGN KEY ("capitalId") REFERENCES "capitals"("id") ON DELETE SET NULL ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "reports" ADD CONSTRAINT "FK_d9013193989303580053c0b5ef6_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );
  }
}
