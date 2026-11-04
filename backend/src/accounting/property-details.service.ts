import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { lockAccountingOwner } from './accounting-lock';
import { parseUuid } from './input';
import { parsePropertyDetails } from './property-details-input';

type Currency = 'USD' | 'EUR' | 'RUB';

export interface PropertyDetails {
  instrumentId: string;
  /** The rent a month, in `currency`; null when none is recorded. */
  monthlyRent: string | null;
  /** The currency the property is valued in, which the rent is entered in. */
  currency: Currency;
  note: string | null;
  /** When the record last changed; null when nothing is recorded. */
  updatedAt: string | null;
}

const select = `SELECT d."instrumentId", d."monthlyRent"::text AS "monthlyRent", d.note,
    i."valuationCurrency" AS currency,
    to_char(d."updatedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
  FROM property_details d
  JOIN accounting_instruments i ON i."ownerId" = d."ownerId" AND i.id = d."instrumentId"`;

/**
 * PROP-DETAILS: the rent and the note an owner keeps with a property. Neither enters a value or
 * a total; they are shown as entered. The command states the whole record, so sending it again
 * changes nothing.
 */
@Injectable()
export class PropertyDetailsService {
  constructor(private readonly source: DataSource) {}

  /** Every property of the owner that has a rent or a note recorded. */
  async list(ownerId: string): Promise<{ items: PropertyDetails[] }> {
    const owner = parseUuid(ownerId);
    const items: PropertyDetails[] = await this.source.query(
      `${select} WHERE d."ownerId"=$1 ORDER BY d."updatedAt" DESC, d."instrumentId"`,
      [owner],
    );
    return { items };
  }

  async set(ownerId: string, instrumentId: string, raw: unknown): Promise<PropertyDetails> {
    const owner = parseUuid(ownerId);
    const id = parseUuid(instrumentId);
    const input = parsePropertyDetails(raw);
    return this.source.transaction(async (manager) => {
      await lockAccountingOwner(manager, owner);
      const currency = await this.valuationCurrency(manager, owner, id);
      if (input.monthlyRent === null && input.note === null) {
        await manager.query(
          'DELETE FROM property_details WHERE "ownerId"=$1 AND "instrumentId"=$2',
          [owner, id],
        );
        return { instrumentId: id, monthlyRent: null, currency, note: null, updatedAt: null };
      }
      // Writing the same record again keeps the moment it was first written.
      await manager.query(
        `INSERT INTO property_details ("ownerId","instrumentId","monthlyRent",note)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT ("ownerId","instrumentId") DO UPDATE SET
           "monthlyRent"=EXCLUDED."monthlyRent", note=EXCLUDED.note,
           "updatedAt"=CASE
             WHEN property_details."monthlyRent" IS NOT DISTINCT FROM EXCLUDED."monthlyRent"
               AND property_details.note IS NOT DISTINCT FROM EXCLUDED.note
             THEN property_details."updatedAt" ELSE now() END`,
        [owner, id, input.monthlyRent, input.note],
      );
      const [row]: PropertyDetails[] = await manager.query(
        `${select} WHERE d."ownerId"=$1 AND d."instrumentId"=$2`,
        [owner, id],
      );
      return row;
    });
  }

  /** Only a hand-valued asset of this owner can be a property. */
  private async valuationCurrency(
    manager: EntityManager,
    owner: string,
    id: string,
  ): Promise<Currency> {
    const [instrument]: { currency: Currency }[] = await manager.query(
      `SELECT "valuationCurrency" AS currency FROM accounting_instruments
       WHERE "ownerId"=$1 AND id=$2 AND "priceSource"='manual' FOR UPDATE`,
      [owner, id],
    );
    if (!instrument) throw new NotFoundException();
    return instrument.currency;
  }
}
