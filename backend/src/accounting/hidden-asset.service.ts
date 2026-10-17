import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { parseUuid } from './input';

interface HiddenRow {
  instrumentId: string;
  name: string;
  symbol: string | null;
  hiddenAt: Date;
}
const hiddenAsset = (row: HiddenRow) => ({
  instrumentId: row.instrumentId,
  name: row.name,
  symbol: row.symbol,
  hiddenAt: row.hiddenAt.toISOString(),
});

/**
 * ASSET-HIDE: the assets the owner hid from the portfolio, its totals and its history. Hiding
 * touches no operation, journal or price; showing the asset again brings everything back.
 */
@Injectable()
export class HiddenAssetService {
  constructor(private readonly source: DataSource) {}

  async list(ownerId: string) {
    const owner = parseUuid(ownerId);
    const rows: HiddenRow[] = await this.source.query(
      `SELECT h."instrumentId", i.name, i.symbol, h."hiddenAt"
        FROM hidden_assets h JOIN accounting_instruments i
          ON i."ownerId"=h."ownerId" AND i.id=h."instrumentId"
        WHERE h."ownerId"=$1 ORDER BY lower(coalesce(i.symbol, i.name)), h."instrumentId"`,
      [owner],
    );
    return { items: rows.map(hiddenAsset) };
  }

  /** Hides the asset; hiding one that is hidden changes nothing. */
  async hide(ownerId: string, instrumentId: string) {
    const owner = parseUuid(ownerId);
    const id = parseUuid(instrumentId);
    const rows: HiddenRow[] = await this.source.query(
      `WITH asset AS (SELECT id, name, symbol FROM accounting_instruments
          WHERE "ownerId"=$1 AND id=$2),
        made AS (INSERT INTO hidden_assets ("ownerId", "instrumentId")
          SELECT $1, id FROM asset
          ON CONFLICT ("ownerId", "instrumentId") DO UPDATE SET "hiddenAt"=hidden_assets."hiddenAt"
          RETURNING "hiddenAt")
        SELECT a.id AS "instrumentId", a.name, a.symbol, m."hiddenAt" FROM asset a, made m`,
      [owner, id],
    );
    if (rows.length === 0) throw new NotFoundException('Asset not found');
    return hiddenAsset(rows[0]);
  }

  /** Shows the asset again; showing one that is not hidden changes nothing. */
  async show(ownerId: string, instrumentId: string) {
    const owner = parseUuid(ownerId);
    const id = parseUuid(instrumentId);
    const found: { id: string }[] = await this.source.query(
      'SELECT id FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2',
      [owner, id],
    );
    if (found.length === 0) throw new NotFoundException('Asset not found');
    await this.source.query('DELETE FROM hidden_assets WHERE "ownerId"=$1 AND "instrumentId"=$2', [
      owner,
      id,
    ]);
    return { instrumentId: id, hidden: false };
  }
}
