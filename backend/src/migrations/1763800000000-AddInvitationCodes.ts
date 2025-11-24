import { MigrationInterface, QueryRunner } from "typeorm";

export class AddInvitationCodes1763800000000 implements MigrationInterface {
    name = 'AddInvitationCodes1763800000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Create invitation_codes table
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "invitation_codes" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "code" character varying NOT NULL,
                "createdByUserId" uuid,
                "usedByUserId" uuid,
                "isUsed" boolean NOT NULL DEFAULT false,
                "usedAt" TIMESTAMP,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_invitation_codes_code" UNIQUE ("code"),
                CONSTRAINT "PK_invitation_codes" PRIMARY KEY ("id")
            )
        `);

        // Add foreign key for createdByUserId (nullable to allow system-generated codes)
        await queryRunner.query(`
            ALTER TABLE "invitation_codes" 
            ADD CONSTRAINT "FK_invitation_codes_createdByUserId" 
            FOREIGN KEY ("createdByUserId") 
            REFERENCES "users"("id") 
            ON DELETE SET NULL 
            ON UPDATE NO ACTION
        `);

        // Add foreign key for usedByUserId
        await queryRunner.query(`
            ALTER TABLE "invitation_codes" 
            ADD CONSTRAINT "FK_invitation_codes_usedByUserId" 
            FOREIGN KEY ("usedByUserId") 
            REFERENCES "users"("id") 
            ON DELETE SET NULL 
            ON UPDATE NO ACTION
        `);

        // Create index for faster lookups
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_invitation_codes_code" 
            ON "invitation_codes" ("code")
        `);

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_invitation_codes_createdByUserId" 
            ON "invitation_codes" ("createdByUserId")
        `);

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_invitation_codes_usedByUserId" 
            ON "invitation_codes" ("usedByUserId")
        `);

        // Create initial invitation code for first user registration
        // Using NULL for createdByUserId to indicate system-generated code
        await queryRunner.query(`
            INSERT INTO "invitation_codes" ("id", "code", "createdByUserId", "isUsed", "createdAt")
            VALUES (
                uuid_generate_v4(),
                'WELCOME2024',
                NULL,
                false,
                now()
            )
            ON CONFLICT DO NOTHING
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Drop indexes
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_invitation_codes_usedByUserId"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_invitation_codes_createdByUserId"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_invitation_codes_code"`);

        // Drop foreign keys
        await queryRunner.query(`ALTER TABLE "invitation_codes" DROP CONSTRAINT IF EXISTS "FK_invitation_codes_usedByUserId"`);
        await queryRunner.query(`ALTER TABLE "invitation_codes" DROP CONSTRAINT IF EXISTS "FK_invitation_codes_createdByUserId"`);

        // Drop table
        await queryRunner.query(`DROP TABLE IF EXISTS "invitation_codes"`);
    }
}

