import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEmailVerificationAndResetFields1732569600000 implements MigrationInterface {
    name = 'AddEmailVerificationAndResetFields1732569600000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "users" 
            ADD COLUMN "emailVerified" boolean NOT NULL DEFAULT false,
            ADD COLUMN "emailVerificationToken" varchar,
            ADD COLUMN "resetPasswordToken" varchar,
            ADD COLUMN "resetPasswordExpires" TIMESTAMP
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "users" 
            DROP COLUMN "resetPasswordExpires",
            DROP COLUMN "resetPasswordToken",
            DROP COLUMN "emailVerificationToken",
            DROP COLUMN "emailVerified"
        `);
    }
}

