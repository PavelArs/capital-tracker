import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { insertObservations } from './bitcoin-history';
import { isExtendedKey } from './bitcoin-xpub';
import { BitcoinXpubSync } from './bitcoin-xpub-sync';
import type { ChainSyncAdapter, StepResult } from './chain-sync';
import {
  type ChainObservation,
  EsploraClient,
  PAGE_SIZE,
  type ProviderFailure,
} from './esplora-client';

// Bounds for one pass; the next pass continues from the committed cursor.
export const MAX_PAGES_PER_SYNC = 10;
const SYNC_TIME_BUDGET_MS = 25_000;

interface WalkRow {
  id: string;
  ownerId: string;
  address: string;
  walkTopTxid: string | null;
  walkCursorTxid: string | null;
  completedTopTxid: string | null;
}

// Bitcoin history from Esplora: a walk from the newest confirmed transaction down to the
// previous walk's newest one, committed page by page.
@Injectable()
export class BitcoinSyncAdapter implements ChainSyncAdapter {
  readonly network = 'bitcoin';
  readonly name = 'Bitcoin';

  // M21: a wallet tracked through its account public key walks each derived address instead.
  private readonly accounts: BitcoinXpubSync;

  constructor(
    private readonly source: DataSource,
    private readonly esplora: EsploraClient,
  ) {
    this.accounts = new BitcoinXpubSync(source, esplora);
  }

  async step(ownerId: string, addressId: string): Promise<StepResult> {
    let state = await this.walk(ownerId, addressId);
    if (isExtendedKey(state.address))
      return this.accounts.step(state.ownerId, state.id, state.address);
    const started = Date.now();
    let imported = 0;
    const finish = (outcome: StepResult['outcome'], reason: ProviderFailure | null) => ({
      outcome,
      reason,
      imported,
    });
    for (let pages = 0; ; pages++) {
      if (pages >= MAX_PAGES_PER_SYNC || Date.now() - started > SYNC_TIME_BUDGET_MS) {
        return finish('partial', null);
      }
      const page = await this.esplora.page(state.address, state.walkCursorTxid);
      if (!page.ok) return finish('provider_error', page.reason);
      if (page.transactions.length === 0) {
        const failure = await this.confirmEnd(state);
        if (failure) return finish('provider_error', failure);
      }
      const committed = await this.commit(state, page.transactions);
      imported += committed.inserted;
      if (committed.finished) return finish('complete', null);
      state = committed.state;
    }
  }

  private async walk(owner: string, id: string): Promise<WalkRow> {
    const [row]: WalkRow[] = await this.source.query(
      `SELECT id, "ownerId", address, "walkTopTxid", "walkCursorTxid", "completedTopTxid"
        FROM wallet_addresses WHERE "ownerId" = $1 AND id = $2 AND network = 'bitcoin'`,
      [owner, id],
    );
    if (!row) throw new NotFoundException();
    return row;
  }

  // Esplora answers [] both at the end of history and when a lagging backend does not
  // know the cursor or the address yet. Accept [] as the end only when the address's
  // confirmed transaction count matches what is stored plus what arrived above the walk.
  private async confirmEnd(state: WalkRow): Promise<ProviderFailure | null> {
    if (state.walkCursorTxid === null) {
      return state.completedTopTxid === null ? null : 'unavailable';
    }
    const total = await this.esplora.transactionCount(state.address);
    if (!total.ok) return total.reason;
    const [{ stored }]: { stored: number }[] = await this.source.query(
      'SELECT count(*)::int AS stored FROM wallet_address_transactions WHERE "addressId" = $1',
      [state.id],
    );
    if (stored === total.count) return null;
    if (stored > total.count) return 'unavailable';
    const top = await this.esplora.page(state.address, null);
    if (!top.ok) return top.reason;
    const newer = top.transactions.findIndex(({ txid }) => txid === state.walkTopTxid);
    return newer >= 0 && stored + newer === total.count ? null : 'unavailable';
  }

  // Stores one page and advances the walk atomically. A walk starts at the newest
  // transaction and ends at the previous walk's newest transaction or the end of
  // history, so an interrupted walk resumes from its cursor without gaps.
  private commit(expected: WalkRow, page: ChainObservation[]) {
    return this.source.transaction('READ COMMITTED', async (manager) => {
      const [current]: WalkRow[] = await manager.query(
        `SELECT * FROM wallet_addresses WHERE "ownerId" = $1 AND id = $2 FOR UPDATE`,
        [expected.ownerId, expected.id],
      );
      if (
        !current ||
        current.walkTopTxid !== expected.walkTopTxid ||
        current.walkCursorTxid !== expected.walkCursorTxid ||
        current.completedTopTxid !== expected.completedTopTxid
      ) {
        throw new ConflictException('Another sync advanced this address');
      }
      const known = current.completedTopTxid
        ? page.findIndex(({ txid }) => txid === current.completedTopTxid)
        : -1;
      const fresh = known >= 0 ? page.slice(0, known) : page;
      const finished = known >= 0 || page.length < PAGE_SIZE;
      const inserted = await insertObservations(manager, current, fresh);
      const walkTop = current.walkTopTxid ?? page[0]?.txid ?? null;
      // TypeORM returns [rows, affected] for UPDATE ... RETURNING on PostgreSQL.
      const [[next]]: [WalkRow[], number] = finished
        ? await manager.query(
            `UPDATE wallet_addresses SET "completedTopTxid" = $3, "completedAt" = clock_timestamp(),
              "walkTopTxid" = NULL, "walkCursorTxid" = NULL
              WHERE "ownerId" = $1 AND id = $2 RETURNING *`,
            [current.ownerId, current.id, walkTop],
          )
        : await manager.query(
            `UPDATE wallet_addresses SET "walkTopTxid" = $3, "walkCursorTxid" = $4
              WHERE "ownerId" = $1 AND id = $2 RETURNING *`,
            [current.ownerId, current.id, walkTop, page[page.length - 1].txid],
          );
      return { inserted, finished, state: { ...expected, ...next } };
    });
  }
}
