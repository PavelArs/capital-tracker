import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { stopTracking } from '../wallet-addresses/wallet-removal';
import { lockAccountingOwner } from './accounting-lock';
import {
  type AssetClassification,
  type AssetType,
  classifyAsset,
  instrumentPayload,
  type PriceSource,
  type ValuationCurrency,
} from './asset-classification';
import {
  type AccountClass,
  parseAccount,
  parseAccountChange,
  parseHistoryQuery,
  parseInstrument,
  parseListQuery,
  parseOpening,
  parseUuid,
  type WalletKind,
} from './input';
import { projectOpening, type SnapshotRow } from './opening.store';
import { TRACKED_ACCOUNT } from './trade-journal.store';

interface AccountRow {
  id: string;
  name: string;
  currentRevision: number | null;
  kind: WalletKind | null;
  assetClass?: AccountClass | null;
  createdAt: Date;
  canonicalPayload: string;
}
interface InstrumentRow extends AssetClassification {
  id: string;
  name: string;
  symbol: string | null;
  namespace: 'manual';
  createdAt: Date;
  canonicalPayload: string;
}
export interface AccountSummary {
  id: string;
  name: string;
  /** W1: software, hardware or exchange; null until the owner says. */
  kind: WalletKind | null;
  /** v8: a broker account or a property; null for a wallet. */
  assetClass: AccountClass | null;
  currentRevision: number;
  createdAt: string;
}
export interface Instrument {
  id: string;
  name: string;
  symbol: string | null;
  namespace: 'manual';
  assetType: AssetType;
  valuationCurrency: ValuationCurrency;
  priceSource: PriceSource;
  createdAt: string;
}
export interface Position {
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  quantity: string;
  costStatus: 'known' | 'unknown';
  totalCostUsd: string | null;
}
export interface Opening {
  accountId: string;
  revision: number;
  requestId: string;
  asOf: string;
  createdAt: string;
  positions: Position[];
}
const accountView = (row: AccountRow): AccountSummary => ({
  id: row.id,
  name: row.name,
  kind: row.kind ?? null,
  assetClass: row.assetClass ?? null,
  currentRevision: row.currentRevision ?? 0,
  createdAt: row.createdAt.toISOString(),
});
const instrumentView = (row: InstrumentRow): Instrument => ({
  id: row.id,
  name: row.name,
  symbol: row.symbol,
  namespace: row.namespace,
  assetType: row.assetType,
  valuationCurrency: row.valuationCurrency,
  priceSource: row.priceSource,
  createdAt: row.createdAt.toISOString(),
});
const conflict = () => new ConflictException('Accounting request conflicts with saved state');
// Service callers use typed numeric pagination; HTTP query strings are parsed in
// the controller. Reject misuse before converting or opening a connection.
function queryNumber(value: unknown): string {
  if (typeof value !== 'number' || !Number.isInteger(value))
    throw new BadRequestException('Invalid accounting input');
  return String(value);
}

@Injectable()
export class AccountingService {
  constructor(private readonly source: DataSource) {}

  async createAccount(
    ownerId: string,
    input: unknown,
  ): Promise<{ created: boolean; value: AccountSummary }> {
    const owner = parseUuid(ownerId);
    const value = parseAccount(input);
    // The kind and the class join the payload only when sent, so an earlier request keeps its
    // exact payload.
    const payload = JSON.stringify({
      name: value.name,
      ...(value.kind ? { kind: value.kind } : {}),
      ...(value.assetClass ? { assetClass: value.assetClass } : {}),
    });
    // Each optional column is named only when sent, so the database checks that build an
    // account on a schema from before the column still work.
    const optional: [string, string][] = [];
    if (value.kind) optional.push(['kind', value.kind]);
    if (value.assetClass) optional.push(['"assetClass"', value.assetClass]);
    const rows: AccountRow[] = await this.source.query(
      `INSERT INTO manual_accounts
      (id,"ownerId","requestId","canonicalPayload",name${optional.map(([column]) => `,${column}`).join('')})
      VALUES ($1,$2,$3,$4,$5${optional.map((_, index) => `,$${index + 6}`).join('')})
      ON CONFLICT ("ownerId","requestId") DO NOTHING RETURNING *`,
      [
        randomUUID(),
        owner,
        value.requestId,
        payload,
        value.name,
        ...optional.map(([, item]) => item),
      ],
    );
    const row =
      rows[0] ??
      ((
        await this.source.query(
          `SELECT * FROM manual_accounts WHERE "ownerId"=$1 AND "requestId"=$2`,
          [owner, value.requestId],
        )
      )[0] as AccountRow | undefined);
    if (!row || row.canonicalPayload !== payload) throw conflict();
    return { created: rows.length === 1, value: accountView(row) };
  }

  async createInstrument(
    ownerId: string,
    input: unknown,
  ): Promise<{ created: boolean; value: Instrument }> {
    const owner = parseUuid(ownerId);
    const value = parseInstrument(input);
    const asset = classifyAsset(value);
    const payload = instrumentPayload(value, asset);
    const rows: InstrumentRow[] = await this.source.query(
      `INSERT INTO accounting_instruments
      (id,"ownerId","requestId","canonicalPayload",name,symbol,"assetType","valuationCurrency","priceSource")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT ("ownerId","requestId") DO NOTHING RETURNING *`,
      [
        randomUUID(),
        owner,
        value.requestId,
        payload,
        value.name,
        value.symbol,
        asset.assetType,
        asset.valuationCurrency,
        asset.priceSource,
      ],
    );
    const row =
      rows[0] ??
      ((
        await this.source.query(
          `SELECT * FROM accounting_instruments WHERE "ownerId"=$1 AND "requestId"=$2`,
          [owner, value.requestId],
        )
      )[0] as InstrumentRow | undefined);
    if (!row || row.canonicalPayload !== payload) throw conflict();
    return { created: rows.length === 1, value: instrumentView(row) };
  }

  async saveOpening(
    ownerId: string,
    accountId: string,
    input: unknown,
  ): Promise<{ created: boolean; value: Opening }> {
    const owner = parseUuid(ownerId);
    const id = parseUuid(accountId);
    const value = parseOpening(input);
    const payload = JSON.stringify({
      expectedRevision: value.expectedRevision,
      asOf: value.asOf,
      positions: value.positions,
    });
    return this.source.transaction(async (manager) => {
      await lockAccountingOwner(manager, owner);
      const [account]: AccountRow[] = await manager.query(
        `SELECT * FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND ${TRACKED_ACCOUNT} FOR UPDATE`,
        [owner, id],
      );
      if (!account) throw new NotFoundException();
      const [previous]: SnapshotRow[] = await manager.query(
        `SELECT * FROM account_opening_snapshots WHERE "ownerId"=$1 AND "accountId"=$2 AND "requestId"=$3`,
        [owner, id, value.requestId],
      );
      if (previous) {
        if (previous.canonicalPayload !== payload) throw conflict();
        return { created: false, value: await projectOpening(manager, owner, previous) };
      }
      const [journal] = await manager.query(
        'SELECT 1 FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2',
        [owner, id],
      );
      if (journal) throw conflict();
      if ((account.currentRevision ?? 0) !== value.expectedRevision) throw conflict();
      const instruments: { id: string }[] = await manager.query(
        'SELECT id FROM accounting_instruments WHERE "ownerId"=$1 AND id=ANY($2::uuid[])',
        [owner, value.positions.map((position) => position.instrumentId)],
      );
      if (instruments.length !== value.positions.length) throw new NotFoundException();
      const revision = value.expectedRevision + 1;
      const [snapshot]: SnapshotRow[] = await manager.query(
        `INSERT INTO account_opening_snapshots
        ("ownerId","accountId",revision,"requestId","canonicalPayload","asOf") VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [owner, id, revision, value.requestId, payload, value.asOf],
      );
      for (const position of value.positions) {
        await manager.query(
          `INSERT INTO account_opening_positions
          ("ownerId","accountId",revision,"instrumentId",quantity,"costStatus","totalCostUsd") VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            owner,
            id,
            revision,
            position.instrumentId,
            position.quantity,
            position.costStatus,
            position.totalCostUsd,
          ],
        );
      }
      await manager.query(
        'UPDATE manual_accounts SET "currentRevision"=$3 WHERE "ownerId"=$1 AND id=$2',
        [owner, id, revision],
      );
      return { created: true, value: await projectOpening(manager, owner, snapshot) };
    });
  }

  async listAccounts(ownerId: string, options: { cursor?: string; limit?: number } = {}) {
    const owner = parseUuid(ownerId);
    const query = parseListQuery({
      ...options,
      ...(options.limit === undefined ? {} : { limit: queryNumber(options.limit) }),
    });
    const rows: AccountRow[] = await this.source.query(
      `SELECT * FROM manual_accounts WHERE "ownerId"=$1 AND "removedAt" IS NULL AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT $3`,
      [owner, query.cursor ?? null, query.limit + 1],
    );
    const items = rows.slice(0, query.limit).map(accountView);
    return { items, nextCursor: rows.length > query.limit ? items[items.length - 1].id : null };
  }

  async listInstruments(ownerId: string, options: { cursor?: string; limit?: number } = {}) {
    const owner = parseUuid(ownerId);
    const query = parseListQuery({
      ...options,
      ...(options.limit === undefined ? {} : { limit: queryNumber(options.limit) }),
    });
    const rows: InstrumentRow[] = await this.source.query(
      `SELECT * FROM accounting_instruments WHERE "ownerId"=$1 AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT $3`,
      [owner, query.cursor ?? null, query.limit + 1],
    );
    const items = rows.slice(0, query.limit).map(instrumentView);
    return { items, nextCursor: rows.length > query.limit ? items[items.length - 1].id : null };
  }

  /**
   * WAL-RENAME, W1: a new name and/or kind for the owner's account; everything recorded in it is
   * unchanged.
   */
  async renameAccount(ownerId: string, accountId: string, input: unknown): Promise<AccountSummary> {
    const owner = parseUuid(ownerId);
    const id = parseUuid(accountId);
    const change = parseAccountChange(input);
    if (change.kind) {
      // How coins are held means nothing for a broker account or a property (v8), and the class
      // never changes once the account exists.
      const found: { assetClass: string | null }[] = await this.source.query(
        'SELECT "assetClass" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND "removedAt" IS NULL',
        [owner, id],
      );
      if (!found[0]) throw new NotFoundException();
      if (found[0].assetClass) throw new BadRequestException('Only a wallet has a kind');
    }
    const [rows]: [AccountRow[], number] = await this.source.query(
      `UPDATE manual_accounts SET name = COALESCE($3, name),
        kind = CASE WHEN $4::boolean THEN $5 ELSE kind END
        WHERE "ownerId"=$1 AND id=$2 AND "removedAt" IS NULL RETURNING *`,
      [owner, id, change.name ?? null, change.kind !== undefined, change.kind ?? null],
    );
    if (!rows[0]) throw new NotFoundException();
    return accountView(rows[0]);
  }

  /**
   * WALLET-REMOVE: stops tracking a wallet that holds no recorded transaction: its addresses
   * stop syncing and it leaves the lists. A wallet with entries in the books stays, because
   * those entries are the history FIFO and the profit figures depend on; only its addresses
   * can be removed.
   */
  async removeAccount(ownerId: string, accountId: string): Promise<void> {
    const owner = parseUuid(ownerId);
    const id = parseUuid(accountId);
    await this.source.transaction('READ COMMITTED', async (manager) => {
      await lockAccountingOwner(manager, owner);
      const found: unknown[] = await manager.query(
        'SELECT 1 FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND "removedAt" IS NULL FOR UPDATE',
        [owner, id],
      );
      if (found.length === 0) throw new NotFoundException();
      // What the wallet's history still rests on: an opening, and entries whose latest version is
      // not voided. An empty journal or a voided entry holds nothing, so it never blocks removal.
      const [held]: {
        openings: number;
        trades: number;
        transfers: number;
        swaps: number;
        rewards: number;
      }[] = await manager.query(
        `SELECT
            (SELECT count(*) FROM account_opening_snapshots
              WHERE "ownerId"=$1 AND "accountId"=$2)::int AS openings,
            (SELECT count(*) FROM account_trades t JOIN account_trade_versions v
              ON v."ownerId"=t."ownerId" AND v."accountId"=t."accountId" AND v."tradeId"=t.id
              AND v.version=t."currentVersion"
              WHERE t."ownerId"=$1 AND t."accountId"=$2 AND v.kind<>'void')::int AS trades,
            (SELECT count(*) FROM owned_transfers t JOIN owned_transfer_versions v
              ON v."ownerId"=t."ownerId" AND v."transferId"=t.id AND v.version=t."currentVersion"
              WHERE t."ownerId"=$1 AND (t."fromAccountId"=$2 OR t."toAccountId"=$2)
              AND v.kind<>'void')::int AS transfers,
            (SELECT count(*) FROM account_swaps t JOIN account_swap_versions v
              ON v."ownerId"=t."ownerId" AND v."accountId"=t."accountId" AND v."swapId"=t.id
              AND v.version=t."currentVersion"
              WHERE t."ownerId"=$1 AND t."accountId"=$2 AND v.kind<>'void')::int AS swaps,
            (SELECT count(*) FROM account_rewards t JOIN account_reward_versions v
              ON v."ownerId"=t."ownerId" AND v."accountId"=t."accountId" AND v."rewardId"=t.id
              AND v.version=t."currentVersion"
              WHERE t."ownerId"=$1 AND t."accountId"=$2 AND v.kind<>'void')::int AS rewards`,
        [owner, id],
      );
      const parts = [
        [held.openings, 'opening balance', 'opening balances'],
        [held.trades, 'trade', 'trades'],
        [held.transfers, 'transfer', 'transfers'],
        [held.swaps, 'swap', 'swaps'],
        [held.rewards, 'reward', 'rewards'],
      ]
        .filter(([n]) => n)
        .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
      if (parts.length > 0)
        throw new ConflictException(
          `This wallet has recorded transactions (${parts.join(', ')}), so it stays in your history. Remove its addresses to stop syncing them.`,
        );
      await stopTracking(manager, owner, { accountId: id });
      await manager.query(
        'UPDATE manual_accounts SET "removedAt"=clock_timestamp() WHERE "ownerId"=$1 AND id=$2',
        [owner, id],
      );
    });
  }

  async getAccount(
    ownerId: string,
    accountId: string,
  ): Promise<AccountSummary & { currentOpening: Opening | null }> {
    const owner = parseUuid(ownerId);
    const id = parseUuid(accountId);
    const [row]: AccountRow[] = await this.source.query(
      'SELECT * FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND "removedAt" IS NULL',
      [owner, id],
    );
    if (!row) throw new NotFoundException();
    let currentOpening: Opening | null = null;
    if (row.currentRevision !== null) {
      const [snapshot]: SnapshotRow[] = await this.source.query(
        'SELECT * FROM account_opening_snapshots WHERE "ownerId"=$1 AND "accountId"=$2 AND revision=$3',
        [owner, id, row.currentRevision],
      );
      currentOpening = await projectOpening(this.source.manager, owner, snapshot);
    }
    return { ...accountView(row), currentOpening };
  }

  async listOpenings(
    ownerId: string,
    accountId: string,
    options: { beforeRevision?: number; limit?: number } = {},
  ) {
    const owner = parseUuid(ownerId);
    const id = parseUuid(accountId);
    const query = parseHistoryQuery({
      ...options,
      ...(options.limit === undefined ? {} : { limit: queryNumber(options.limit) }),
      ...(options.beforeRevision === undefined
        ? {}
        : { beforeRevision: queryNumber(options.beforeRevision) }),
    });
    const [account] = await this.source.query(
      `SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND ${TRACKED_ACCOUNT}`,
      [owner, id],
    );
    if (!account) throw new NotFoundException();
    const rows: SnapshotRow[] = await this.source.query(
      `SELECT * FROM account_opening_snapshots WHERE "ownerId"=$1 AND "accountId"=$2 AND ($3::int IS NULL OR revision<$3) ORDER BY revision DESC LIMIT $4`,
      [owner, id, query.beforeRevision ?? null, query.limit + 1],
    );
    const items = await Promise.all(
      rows.slice(0, query.limit).map((row) => projectOpening(this.source.manager, owner, row)),
    );
    return {
      items,
      nextCursor: rows.length > query.limit ? items[items.length - 1].revision : null,
    };
  }
}
