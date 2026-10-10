import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BlockbookClient, type ZcashLeg } from './blockbook-client';
import type { ChainSyncAdapter, StepFailure, StepResult } from './chain-sync';

// Bounds for one pass; the next pass continues from the committed page.
export const MAX_ZCASH_PAGES = 8;
const SYNC_TIME_BUDGET_MS = 25_000;
// A walk ends this many blocks below the indexed tip, so a block it reads is not replaced.
export const ZCASH_CONFIRMATIONS = 3;

interface WalkRow {
  id: string;
  ownerId: string;
  address: string;
  /** The newest block whose transactions are all stored; null before the first walk ends. */
  readTo: number | null;
  /** The walk under way: its last block, the next page and the page count it found. */
  walkTo: number | null;
  walkPage: number | null;
  walkPages: number | null;
}
interface Walk {
  to: number;
  page: number;
  pages: number | null;
}

/**
 * ZCASH-SYNC: transparent Zcash history from Blockbook. A walk fixes a block range, from the
 * block after the last walk to a few blocks below the tip, and reads its pages one by one;
 * each page is committed with the walk's place, so an interrupted pass resumes where it
 * stopped. Rows are stored once each, so a page read again changes nothing.
 */
@Injectable()
export class ZcashSyncAdapter implements ChainSyncAdapter {
  readonly network = 'zcash';
  readonly name = 'Zcash';

  constructor(
    private readonly source: DataSource,
    private readonly client: BlockbookClient,
  ) {}

  async step(ownerId: string, addressId: string): Promise<StepResult> {
    let state = await this.scan(ownerId, addressId);
    let imported = 0;
    const failed = (reason: StepFailure): StepResult => ({
      outcome: 'provider_error',
      reason,
      imported,
    });
    const from = state.readTo === null ? 0 : state.readTo + 1;
    let walk: Walk;
    if (state.walkTo === null || state.walkPage === null) {
      const status = await this.client.status();
      if (!status.ok) return failed(status.reason);
      const to = status.height - ZCASH_CONFIRMATIONS + 1;
      if (to < from) {
        await this.commit(state, [], null, true);
        return { outcome: 'complete', reason: null, imported };
      }
      walk = { to, page: 1, pages: null };
    } else {
      walk = { to: state.walkTo, page: state.walkPage, pages: state.walkPages };
    }
    const started = Date.now();
    for (let pages = 0; pages < MAX_ZCASH_PAGES; pages++) {
      if (Date.now() - started > SYNC_TIME_BUDGET_MS) break;
      const read = await this.client.page(state.address, from, walk.to, walk.page);
      if (!read.ok) return failed(read.reason);
      if (walk.pages !== null && read.totalPages !== walk.pages) {
        // The range holds other transactions than when the walk began (the instance followed
        // a reorganisation or reindexed): read it again from its first page.
        walk = { ...walk, page: 1, pages: null };
        continue;
      }
      const last = walk.page >= read.totalPages;
      const next: Walk | null = last
        ? null
        : { ...walk, page: walk.page + 1, pages: read.totalPages };
      const committed = await this.commit(state, read.legs, next ?? walk, last);
      imported += committed.inserted;
      if (last) return { outcome: 'complete', reason: null, imported };
      state = committed.state;
      walk = next as Walk;
    }
    return { outcome: 'partial', reason: null, imported };
  }

  private async scan(owner: string, id: string): Promise<WalkRow> {
    await this.source.query(
      `INSERT INTO wallet_zcash_accounts ("ownerId", "addressId")
        SELECT "ownerId", id FROM wallet_addresses
          WHERE "ownerId" = $1 AND id = $2 AND network = 'zcash'
        ON CONFLICT ("addressId") DO NOTHING`,
      [owner, id],
    );
    const [row]: WalkRow[] = await this.source.query(
      `SELECT a.id, a."ownerId", a.address, z."readTo", z."walkTo", z."walkPage", z."walkPages"
        FROM wallet_addresses a JOIN wallet_zcash_accounts z ON z."addressId" = a.id
        WHERE a."ownerId" = $1 AND a.id = $2 AND a.network = 'zcash'`,
      [owner, id],
    );
    if (!row) throw new NotFoundException();
    return row;
  }

  /**
   * Stores a page and the walk's next place in one transaction; `finished` ends the walk at
   * its last block. A walk that found nothing new (`walk` null) only marks the history read.
   */
  private commit(expected: WalkRow, legs: ZcashLeg[], walk: Walk | null, finished: boolean) {
    return this.source.transaction('READ COMMITTED', async (manager) => {
      const [current]: WalkRow[] = await manager.query(
        `SELECT a.id, a."ownerId", a.address, z."readTo", z."walkTo", z."walkPage", z."walkPages"
          FROM wallet_addresses a JOIN wallet_zcash_accounts z ON z."addressId" = a.id
          WHERE a."ownerId" = $1 AND a.id = $2 FOR UPDATE`,
        [expected.ownerId, expected.id],
      );
      if (
        !current ||
        current.readTo !== expected.readTo ||
        current.walkTo !== expected.walkTo ||
        current.walkPage !== expected.walkPage
      ) {
        throw new ConflictException('Another sync advanced this address');
      }
      const inserted = await this.insert(manager, current, legs);
      const [[next]]: [WalkRow[], number] =
        finished && walk
          ? await manager.query(
              `UPDATE wallet_zcash_accounts SET "readTo" = $2,
                "walkTo" = NULL, "walkPage" = NULL, "walkPages" = NULL
                WHERE "addressId" = $1 RETURNING *`,
              [current.id, walk.to],
            )
          : walk
            ? await manager.query(
                `UPDATE wallet_zcash_accounts SET "walkTo" = $2, "walkPage" = $3, "walkPages" = $4
                  WHERE "addressId" = $1 RETURNING *`,
                [current.id, walk.to, walk.page, walk.pages],
              )
            : [[current], 0];
      // "scannedBlock" is the newest block read in full; "completedAt" marks a history read
      // to the tip, so the balance can be shown.
      await manager.query(
        `UPDATE wallet_addresses SET
          "scannedBlock" = coalesce($3::int, "scannedBlock", 0),
          "completedAt" = CASE WHEN $4 THEN clock_timestamp() ELSE "completedAt" END
          WHERE "ownerId" = $1 AND id = $2`,
        [current.ownerId, current.id, finished && walk ? walk.to : null, finished],
      );
      return { inserted, state: { ...current, ...next } as WalkRow };
    });
  }

  private async insert(manager: EntityManager, address: WalkRow, legs: ZcashLeg[]) {
    if (legs.length === 0) return 0;
    const values: unknown[] = [];
    const rows = legs.map((leg) => {
      const base = values.length;
      values.push(
        address.ownerId,
        address.id,
        leg.txid,
        leg.blockHeight,
        leg.blockHash,
        leg.blockTime,
        leg.receivedUnits.toString(),
        leg.sentUnits.toString(),
        leg.feeUnits.toString(),
        leg.direction,
        JSON.stringify(leg.raw),
      );
      const slot = (offset: number) => `$${base + offset}`;
      return `(${slot(1)},${slot(2)},${slot(3)},${slot(4)},${slot(5)},${slot(6)},${slot(7)}::numeric,${slot(8)}::numeric,${slot(9)}::numeric,${slot(10)},${slot(11)}::jsonb,NULL)`;
    });
    const inserted: { txid: string }[] = await manager.query(
      `INSERT INTO wallet_address_transactions ("ownerId", "addressId", txid, "blockHeight", "blockHash",
        "blockTime", "receivedUnits", "sentUnits", "feeUnits", direction, raw, asset)
        VALUES ${rows.join(',')} ON CONFLICT ("addressId", txid) DO NOTHING RETURNING txid`,
      values,
    );
    return inserted.length;
  }
}
