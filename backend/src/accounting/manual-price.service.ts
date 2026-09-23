import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { ManualUsdPriceVersion } from '../entities/manual-usd-price-version.entity';
import { parseDecimal, parseUuid } from './input';
import {
  MAX_PRICE_VERSIONS,
  parsePriceHistoryQuery,
  parsePricePageQuery,
  parsePriceSet,
  parsePriceVoid,
} from './manual-price-input';

const provenance = { source: 'manual' as const, quoteCurrency: 'USD' as const };
const conflict = () => new ConflictException('Manual price request conflicts with saved state');
type Command = ReturnType<typeof parsePriceVoid> & {
  kind: 'set' | 'void';
  priceUsd: string | null;
};

function receipt(row: ManualUsdPriceVersion) {
  return {
    instrumentId: row.instrumentId,
    revision: row.revision,
    requestId: row.requestId,
    kind: row.kind,
    observedAt: row.observedAt.toISOString(),
    priceUsd: row.priceUsd === null ? null : parseDecimal(row.priceUsd, false),
    createdAt: row.createdAt.toISOString(),
    ...provenance,
  };
}

@Injectable()
export class ManualPriceService {
  constructor(private readonly source: DataSource) {}

  set(ownerId: string, instrumentId: string, raw: unknown) {
    return this.write(parseUuid(ownerId), parseUuid(instrumentId), {
      ...parsePriceSet(raw),
      kind: 'set',
    });
  }

  void(ownerId: string, instrumentId: string, raw: unknown) {
    return this.write(parseUuid(ownerId), parseUuid(instrumentId), {
      ...parsePriceVoid(raw),
      kind: 'void',
      priceUsd: null,
    });
  }

  private write(owner: string, id: string, input: Command) {
    const canonicalPayload = JSON.stringify({
      kind: input.kind,
      expectedRevision: input.expectedRevision,
      observedAt: input.observedAt,
      priceUsd: input.priceUsd,
    });
    return this.source.transaction('READ COMMITTED', async (manager) => {
      await this.instrument(manager, owner, id, true);
      const [previous]: ManualUsdPriceVersion[] = await manager.query(
        'SELECT * FROM manual_usd_price_versions WHERE "ownerId"=$1 AND "instrumentId"=$2 AND "requestId"=$3',
        [owner, id, input.requestId],
      );
      if (previous) {
        if (previous.canonicalPayload !== canonicalPayload) throw conflict();
        return { created: false, value: receipt(previous) };
      }
      const revision = await this.revision(manager, owner, id);
      if (revision !== input.expectedRevision || revision >= MAX_PRICE_VERSIONS) throw conflict();
      if (input.kind === 'void') {
        const [head]: ManualUsdPriceVersion[] = await manager.query(
          'SELECT * FROM manual_usd_price_versions WHERE "ownerId"=$1 AND "instrumentId"=$2 AND "observedAt"=$3 ORDER BY revision DESC LIMIT 1',
          [owner, id, input.observedAt],
        );
        if (!head || head.kind === 'void') throw conflict();
      }
      const [row]: ManualUsdPriceVersion[] = await manager.query(
        `INSERT INTO manual_usd_price_versions
          ("ownerId","instrumentId",revision,"requestId","canonicalPayload",kind,"observedAt","priceUsd")
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          owner,
          id,
          revision + 1,
          input.requestId,
          canonicalPayload,
          input.kind,
          input.observedAt,
          input.priceUsd,
        ],
      );
      return { created: true, value: receipt(row) };
    });
  }

  list(ownerId: string, instrumentId: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const id = parseUuid(instrumentId);
    const input = parsePricePageQuery(raw);
    return this.read(async (manager) => {
      const instrument = await this.instrument(manager, owner, id);
      const currentRevision = await this.revision(manager, owner, id);
      if (input.revision !== undefined && input.revision !== currentRevision) throw conflict();
      const rows: ManualUsdPriceVersion[] = await manager.query(
        `SELECT * FROM (
          SELECT DISTINCT ON ("observedAt") * FROM manual_usd_price_versions
          WHERE "ownerId"=$1 AND "instrumentId"=$2 ORDER BY "observedAt" DESC, revision DESC
        ) heads WHERE kind='set' ORDER BY "observedAt" DESC LIMIT $3 OFFSET $4`,
        [owner, id, input.limit + 1, input.offset],
      );
      return {
        instrument,
        currentRevision,
        ...provenance,
        items: rows.slice(0, input.limit).map(receipt),
        nextOffset: rows.length > input.limit ? input.offset + input.limit : null,
      };
    });
  }

  history(ownerId: string, instrumentId: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const id = parseUuid(instrumentId);
    const input = parsePriceHistoryQuery(raw);
    return this.read(async (manager) => {
      await this.instrument(manager, owner, id);
      const rows: ManualUsdPriceVersion[] = await manager.query(
        `SELECT * FROM manual_usd_price_versions
          WHERE "ownerId"=$1 AND "instrumentId"=$2 AND "observedAt"=$3 AND revision<$4
          ORDER BY revision DESC LIMIT $5`,
        [
          owner,
          id,
          input.observedAt,
          input.beforeRevision ?? MAX_PRICE_VERSIONS + 1,
          input.limit + 1,
        ],
      );
      const items = rows.slice(0, input.limit).map(receipt);
      return {
        instrumentId: id,
        observedAt: input.observedAt,
        ...provenance,
        items,
        nextBeforeRevision: rows.length > input.limit ? items[items.length - 1].revision : null,
      };
    });
  }

  private async instrument(manager: EntityManager, owner: string, id: string, lock = false) {
    const [instrument]: { id: string; name: string; symbol: string | null; namespace: 'manual' }[] =
      await manager.query(
        `SELECT id,name,symbol,namespace FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`,
        [owner, id],
      );
    if (!instrument) throw new NotFoundException();
    return instrument;
  }

  private async revision(manager: EntityManager, owner: string, id: string): Promise<number> {
    const [row]: { revision: number }[] = await manager.query(
      'SELECT COALESCE(MAX(revision),0)::int AS revision FROM manual_usd_price_versions WHERE "ownerId"=$1 AND "instrumentId"=$2',
      [owner, id],
    );
    return row.revision;
  }

  private read<T>(action: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      return action(manager);
    });
  }
}
