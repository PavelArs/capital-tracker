import { ConflictException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { insertObservations } from './bitcoin-history';
import { AccountKey } from './bitcoin-xpub';
import type { StepResult } from './chain-sync';
import {
  type ChainObservation,
  type EsploraClient,
  PAGE_SIZE,
  type ProviderFailure,
} from './esplora-client';

/** BIP-44 address gap: the scan ends after this many unused addresses in a row on each chain. */
export const GAP_LIMIT = 20;
// Bounds for one pass; the next pass continues where this one stopped.
export const MAX_REQUESTS_PER_SYNC = 40;
const SYNC_TIME_BUDGET_MS = 25_000;
const CHAINS = [0, 1] as const;

interface DerivedRow {
  ownerId: string;
  walletId: string;
  chain: 0 | 1;
  addressIndex: number;
  address: string;
  /** Confirmed transactions the provider last reported; null until first asked. */
  txCount: number | null;
  /** How many of them the stored history holds. */
  storedCount: number;
  checkPending: boolean;
  walkTopTxid: string | null;
  walkCursorTxid: string | null;
  walkSeen: number;
  completedTopTxid: string | null;
}

class Lagging extends Error {}

/**
 * XPUB-SCAN: one Bitcoin account tracked through its public key. A round first asks the
 * transaction count of every derived address, deriving more until 20 in a row on each chain
 * are unused, so the whole set of the account's addresses is known. Then it walks the history
 * of each address whose count grew, newest first like a single address, and stores each
 * transaction once for the wallet with its effect on all of the account's addresses: change
 * and moves between its own addresses stay inside the wallet.
 */
export class BitcoinXpubSync {
  constructor(
    private readonly source: DataSource,
    private readonly esplora: EsploraClient,
  ) {}

  async step(ownerId: string, walletId: string, key: string): Promise<StepResult> {
    const account = new AccountKey(key);
    const started = Date.now();
    let requests = 0;
    let imported = 0;
    const finish = (outcome: StepResult['outcome'], reason: ProviderFailure | null) => ({
      outcome,
      reason,
      imported,
    });
    const spent = () =>
      requests >= MAX_REQUESTS_PER_SYNC || Date.now() - started > SYNC_TIME_BUDGET_MS;

    await this.extend(ownerId, walletId, account);
    await this.startRound(walletId);

    // Every address of the round is counted before any history is read.
    for (let row = await this.nextCheck(walletId); row; row = await this.nextCheck(walletId)) {
      if (spent()) return finish('partial', null);
      requests++;
      const count = await this.esplora.transactionCount(row.address);
      if (!count.ok) return finish('provider_error', count.reason);
      await this.source.query(
        `UPDATE wallet_xpub_addresses SET "txCount" = $4, "checkPending" = false
          WHERE "walletId" = $1 AND chain = $2 AND "addressIndex" = $3`,
        [walletId, row.chain, row.addressIndex, count.count],
      );
      if (count.count > 0) await this.extend(ownerId, walletId, account);
    }

    for (let row = await this.nextWalk(walletId); row; row = await this.nextWalk(walletId)) {
      const owned = await this.owned(walletId);
      for (let state: DerivedRow = row; ; ) {
        if (spent()) return finish('partial', null);
        requests++;
        const page = await this.esplora.page(state.address, state.walkCursorTxid, owned);
        if (!page.ok) return finish('provider_error', page.reason);
        let committed: Awaited<ReturnType<BitcoinXpubSync['commit']>>;
        try {
          committed = await this.commit(state, page.transactions);
        } catch (error) {
          if (error instanceof Lagging) return finish('provider_error', 'unavailable');
          throw error;
        }
        imported += committed.inserted;
        if (committed.finished) break;
        state = committed.state;
      }
    }

    await this.source.query(
      `UPDATE wallet_addresses SET "completedAt" = clock_timestamp()
        WHERE "ownerId" = $1 AND id = $2`,
      [ownerId, walletId],
    );
    return finish('complete', null);
  }

  // Derives each chain up to GAP_LIMIT addresses past its last used one. Derivation is local;
  // a new address waits for the count of this round.
  private async extend(ownerId: string, walletId: string, account: AccountKey): Promise<void> {
    const ends: { chain: 0 | 1; derived: number; used: number }[] = await this.source.query(
      `SELECT c.chain,
          coalesce(max(d."addressIndex"), -1)::int AS derived,
          coalesce(max(d."addressIndex") FILTER (WHERE d."txCount" > 0), -1)::int AS used
        FROM unnest(ARRAY[0, 1]::smallint[]) AS c(chain)
        LEFT JOIN wallet_xpub_addresses d ON d."walletId" = $1 AND d.chain = c.chain
        GROUP BY c.chain`,
      [walletId],
    );
    const values: unknown[] = [];
    const rows: string[] = [];
    for (const chain of CHAINS) {
      const end = ends.find((item) => Number(item.chain) === chain);
      const from = (end?.derived ?? -1) + 1;
      const to = (end?.used ?? -1) + GAP_LIMIT;
      for (let index = from; index <= to; index++) {
        const base = values.length;
        values.push(ownerId, walletId, chain, index, account.address(chain, index));
        rows.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
      }
    }
    if (rows.length === 0) return;
    await this.source.query(
      `INSERT INTO wallet_xpub_addresses ("ownerId", "walletId", chain, "addressIndex", address)
        VALUES ${rows.join(',')} ON CONFLICT DO NOTHING`,
      values,
    );
  }

  // A round starts once the previous one has counted and stored everything.
  private async startRound(walletId: string): Promise<void> {
    await this.source.query(
      `UPDATE wallet_xpub_addresses SET "checkPending" = true
        WHERE "walletId" = $1 AND NOT EXISTS (SELECT 1 FROM wallet_xpub_addresses d
          WHERE d."walletId" = $1 AND (d."checkPending" OR d."walkTopTxid" IS NOT NULL
            OR d."txCount" > d."storedCount"))`,
      [walletId],
    );
  }

  private async nextCheck(walletId: string): Promise<DerivedRow | undefined> {
    const [row]: DerivedRow[] = await this.source.query(
      `SELECT * FROM wallet_xpub_addresses WHERE "walletId" = $1 AND "checkPending"
        ORDER BY chain, "addressIndex" LIMIT 1`,
      [walletId],
    );
    return row;
  }

  private async nextWalk(walletId: string): Promise<DerivedRow | undefined> {
    const [row]: DerivedRow[] = await this.source.query(
      `SELECT * FROM wallet_xpub_addresses
        WHERE "walletId" = $1 AND ("walkTopTxid" IS NOT NULL OR "txCount" > "storedCount")
        ORDER BY chain, "addressIndex" LIMIT 1`,
      [walletId],
    );
    return row;
  }

  private async owned(walletId: string): Promise<ReadonlySet<string>> {
    const rows: { address: string }[] = await this.source.query(
      'SELECT address FROM wallet_xpub_addresses WHERE "walletId" = $1',
      [walletId],
    );
    return new Set(rows.map(({ address }) => address));
  }

  // Stores one page of an address's history and advances its walk atomically, as a single
  // Bitcoin address does. A walk that ends with fewer transactions than the count promised
  // met a lagging provider and is retried later from the same cursor.
  private commit(expected: DerivedRow, page: ChainObservation[]) {
    return this.source.transaction('READ COMMITTED', async (manager: EntityManager) => {
      const [current]: DerivedRow[] = await manager.query(
        `SELECT * FROM wallet_xpub_addresses
          WHERE "walletId" = $1 AND chain = $2 AND "addressIndex" = $3 FOR UPDATE`,
        [expected.walletId, expected.chain, expected.addressIndex],
      );
      if (
        !current ||
        current.walkTopTxid !== expected.walkTopTxid ||
        current.walkCursorTxid !== expected.walkCursorTxid ||
        current.completedTopTxid !== expected.completedTopTxid ||
        current.storedCount !== expected.storedCount ||
        current.walkSeen !== expected.walkSeen
      ) {
        throw new ConflictException('Another sync advanced this address');
      }
      const known = current.completedTopTxid
        ? page.findIndex(({ txid }) => txid === current.completedTopTxid)
        : -1;
      const fresh = known >= 0 ? page.slice(0, known) : page;
      const finished = known >= 0 || page.length < PAGE_SIZE;
      const seen = current.walkSeen + fresh.length;
      if (finished && current.storedCount + seen < (current.txCount ?? 0)) throw new Lagging();
      const inserted = await insertObservations(
        manager,
        { ownerId: current.ownerId, id: current.walletId },
        fresh,
      );
      const walkTop = current.walkTopTxid ?? page[0]?.txid ?? null;
      // TypeORM returns [rows, affected] for UPDATE ... RETURNING on PostgreSQL.
      const [[next]]: [DerivedRow[], number] = finished
        ? await manager.query(
            `UPDATE wallet_xpub_addresses SET
              "completedTopTxid" = coalesce($4, "completedTopTxid"), "storedCount" = $5,
              "walkTopTxid" = NULL, "walkCursorTxid" = NULL, "walkSeen" = 0
              WHERE "walletId" = $1 AND chain = $2 AND "addressIndex" = $3 RETURNING *`,
            [
              current.walletId,
              current.chain,
              current.addressIndex,
              walkTop,
              current.storedCount + seen,
            ],
          )
        : await manager.query(
            `UPDATE wallet_xpub_addresses SET "walkTopTxid" = $4, "walkCursorTxid" = $5, "walkSeen" = $6
              WHERE "walletId" = $1 AND chain = $2 AND "addressIndex" = $3 RETURNING *`,
            [
              current.walletId,
              current.chain,
              current.addressIndex,
              walkTop,
              page[page.length - 1].txid,
              seen,
            ],
          );
      return { inserted, finished, state: next };
    });
  }
}
