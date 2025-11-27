import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEmailVerificationAndResetFields1763900000000 implements MigrationInterface {
  name = 'AddEmailVerificationAndResetFields1763900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add columns one by one with IF NOT EXISTS check
    await queryRunner.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                               WHERE table_name='users' AND column_name='emailVerified') THEN
                    ALTER TABLE "users" ADD COLUMN "emailVerified" boolean NOT NULL DEFAULT false;
                END IF;
            END $$;
        `);

    await queryRunner.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                               WHERE table_name='users' AND column_name='emailVerificationToken') THEN
                    ALTER TABLE "users" ADD COLUMN "emailVerificationToken" varchar;
                END IF;
            END $$;
        `);

    await queryRunner.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                               WHERE table_name='users' AND column_name='resetPasswordToken') THEN
                    ALTER TABLE "users" ADD COLUMN "resetPasswordToken" varchar;
                END IF;
            END $$;
        `);

    await queryRunner.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                               WHERE table_name='users' AND column_name='resetPasswordExpires') THEN
                    ALTER TABLE "users" ADD COLUMN "resetPasswordExpires" TIMESTAMP;
                END IF;
            END $$;
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "users" 
            DROP COLUMN IF EXISTS "resetPasswordExpires",
            DROP COLUMN IF EXISTS "resetPasswordToken",
            DROP COLUMN IF EXISTS "emailVerificationToken",
            DROP COLUMN IF EXISTS "emailVerified"
        `);
  }
}
