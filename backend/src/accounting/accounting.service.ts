import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
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
  parseAccount,
  parseHistoryQuery,
  parseInstrument,
  parseListQuery,
  parseOpening,
  parseUuid,
} from './input';
import { projectOpening, type SnapshotRow } from './opening.store';

interface AccountRow {
  id: string;
  name: string;
  currentRevision: number | null;
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
    const payload = JSON.stringify({ name: value.name });
    const rows: AccountRow[] = await this.source.query(
      `INSERT INTO manual_accounts
      (id,"ownerId","requestId","canonicalPayload",name) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT ("ownerId","requestId") DO NOTHING RETURNING *`,
      [randomUUID(), owner, value.requestId, payload, value.name],
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
        'SELECT * FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 FOR UPDATE',
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
      `SELECT * FROM manual_accounts WHERE "ownerId"=$1 AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT $3`,
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

  async getAccount(
    ownerId: string,
    accountId: string,
  ): Promise<AccountSummary & { currentOpening: Opening | null }> {
    const owner = parseUuid(ownerId);
    const id = parseUuid(accountId);
    const [row]: AccountRow[] = await this.source.query(
      'SELECT * FROM manual_accounts WHERE "ownerId"=$1 AND id=$2',
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
      'SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=$2',
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
