import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPropertyDetails1798600000000 implements MigrationInterface {
  name = 'AddPropertyDetails1798600000000';

  async up(runner: QueryRunner): Promise<void> {
    // PROP-DETAILS: what the owner records about a property besides its estimate and purchase:
    // the rent it brings a month (in the currency the property is valued in) and a free note, for
    // example a mortgage. Both are shown as entered; neither is added to any value. A row exists
    // only while one of them is set, so "nothing recorded" is the absence of a row.
    await runner.query(`CREATE TABLE property_details (
      "ownerId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      "instrumentId" uuid NOT NULL,
      "monthlyRent" numeric(30, 2) CHECK ("monthlyRent" > 0),
      note text CHECK (note IS NULL OR (btrim(note) <> '' AND char_length(note) <= 500)),
      "updatedAt" timestamptz(3) NOT NULL DEFAULT now(),
      PRIMARY KEY ("ownerId", "instrumentId"),
      FOREIGN KEY ("ownerId", "instrumentId")
        REFERENCES accounting_instruments ("ownerId", id) ON DELETE RESTRICT,
      CHECK ("monthlyRent" IS NOT NULL OR note IS NOT NULL)
    )`);
  }

  async down(): Promise<void> {
    throw new Error('Property details downgrade requires an explicit recovery plan');
  }
}
