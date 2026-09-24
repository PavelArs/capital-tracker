import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { lockAccountingOwner } from './accounting-lock';
import {
  advanceConnectedJournals,
  assertRevisionCapacity,
  projectConnectedLedger,
  readConnectedLedger,
  rethrowAccountingHistory,
} from './connected-accounting.store';
import { parseUuid } from './input';
import {
  type TransferCorrectionInput,
  type TransferCreateInput,
  type TransferMovement,
  type TransferVoidInput,
  parseTransferAllocationQuery,
  parseTransferCorrection,
  parseTransferCreate,
  parseTransferHistoryQuery,
  parseTransferListQuery,
  parseTransferVoid,
  transferPayload,
} from './owned-transfer-input';
import {
  TRANSFER_LIMITS,
  type TransferKind,
  type TransferVersionRow,
  appendTransferVersion,
  projectTransferVersion,
  readTransferHead,
  readTransferHeads,
  readTransferReplay,
  readTransferRevision,
  transferReceipt,
  transferVersionSelect,
} from './owned-transfer.store';
import { readJournal, readOwnedAccount } from './trade-journal.store';

const conflict = () => new ConflictException('Transfer request conflicts with saved state');
function movement(value: TransferMovement): TransferMovement {
  return {
    instrumentId: value.instrumentId,
    occurredAt: value.occurredAt,
    orderWithinTimestamp: value.orderWithinTimestamp,
    quantity: value.quantity,
    feeInstrumentId: value.feeInstrumentId,
    feeQuantity: value.feeQuantity,
  };
}

@Injectable()
export class OwnedTransferService {
  constructor(private readonly source: DataSource) {}

  async create(owner: string, raw: unknown) {
    return this.mutate(parseUuid(owner), 'create', parseTransferCreate(raw));
  }
  async correct(owner: string, id: string, raw: unknown) {
    return this.mutate(parseUuid(owner), 'correct', parseTransferCorrection(raw), parseUuid(id));
  }
  async void(owner: string, id: string, raw: unknown) {
    return this.mutate(parseUuid(owner), 'void', parseTransferVoid(raw), parseUuid(id));
  }

  private async mutate(
    owner: string,
    kind: TransferKind,
    input: TransferCreateInput | TransferCorrectionInput | TransferVoidInput,
    target?: string,
  ) {
    const payload = transferPayload(kind, input, target);
    try {
      return await this.source.transaction(async (manager) => {
        await lockAccountingOwner(manager, owner);
        const replay = await readTransferReplay(manager, owner, input.requestId);
        if (replay) {
          if (replay.canonicalPayload !== payload) throw conflict();
          return { created: false, value: transferReceipt(replay) };
        }
        const row =
          target === undefined ? undefined : await readTransferHead(manager, owner, target);
        if (target !== undefined && !row) throw new NotFoundException();
        const current = row ? projectTransferVersion(row) : undefined;
        const pair = 'fromAccountId' in input ? input : current;
        if (!pair) throw new Error('Transfer target required');
        const { fromAccountId, toAccountId } = pair;
        await readOwnedAccount(manager, owner, fromAccountId);
        await readOwnedAccount(manager, owner, toAccountId);
        if (fromAccountId === toAccountId) throw conflict();
        if (
          'expectedVersion' in input &&
          (current?.kind === 'void' || current?.version !== input.expectedVersion)
        )
          throw conflict();
        const fields = 'quantity' in input ? movement(input) : current && movement(current);
        if (!fields) throw new Error('Transfer movement required');
        const labels = await this.labels(manager, owner, fields);
        const revision = await readTransferRevision(manager, owner);
        if (revision >= TRANSFER_LIMITS.versions) throw conflict();
        const heads = await readTransferHeads(manager, owner);
        if (kind === 'create' && heads.length >= TRANSFER_LIMITS.activeTransfers) throw conflict();
        const transferId = target ?? randomUUID();
        const next = {
          ...fields,
          ...labels,
          fromAccountId,
          toAccountId,
          transferId,
          version: (current?.version ?? 0) + 1,
        };
        const candidates = heads.filter((head) => head.transferId !== transferId);
        const candidateEvents = kind === 'void' ? candidates : [...candidates, next];
        const ledger = await readConnectedLedger(manager, owner, [fromAccountId, toAccountId], {
          lock: true,
          transfers: heads,
          candidateTransfers: candidateEvents,
        });
        const from = ledger.accounts.get(fromAccountId)!.journal;
        const to = ledger.accounts.get(toAccountId)!.journal;
        if (
          from.currentRevision !== input.expectedFromJournalRevision ||
          to.currentRevision !== input.expectedToJournalRevision
        )
          throw conflict();
        assertRevisionCapacity(ledger);
        projectConnectedLedger(ledger);
        projectConnectedLedger(ledger, {
          transfers: candidateEvents.filter((event) => ledger.accounts.has(event.fromAccountId)),
        });
        const receipt = await appendTransferVersion(manager, owner, {
          ...next,
          kind,
          requestId: input.requestId,
          canonicalPayload: payload,
          journalRevision: revision + 1,
          fromJournalRevision: from.currentRevision + 1,
          toJournalRevision: to.currentRevision + 1,
        });
        await advanceConnectedJournals(manager, owner, ledger);
        return { created: true, value: receipt };
      });
    } catch (error) {
      return rethrowAccountingHistory(error);
    }
  }

  private async labels(manager: EntityManager, owner: string, value: TransferMovement) {
    const ids = [
      ...new Set([value.instrumentId, ...(value.feeInstrumentId ? [value.feeInstrumentId] : [])]),
    ];
    const rows: { id: string; name: string; symbol: string | null }[] = await manager.query(
      'SELECT id,name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=ANY($2::uuid[])',
      [owner, ids],
    );
    if (rows.length !== ids.length) throw new NotFoundException();
    const principal = rows.find((row) => row.id === value.instrumentId)!;
    const fee = rows.find((row) => row.id === value.feeInstrumentId);
    return {
      instrumentName: principal.name,
      instrumentSymbol: principal.symbol,
      feeInstrumentName: fee?.name ?? null,
      feeInstrumentSymbol: fee?.symbol ?? null,
    };
  }

  private read<T>(work: (manager: EntityManager) => Promise<T>) {
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      try {
        return await work(manager);
      } catch (error) {
        return rethrowAccountingHistory(error);
      }
    });
  }

  async list(ownerId: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const query = parseTransferListQuery(raw);
    return this.read(async (manager) => {
      const journalRevision = await readTransferRevision(manager, owner);
      if (query.journalRevision !== undefined && query.journalRevision !== journalRevision)
        throw conflict();
      const [counts]: { active: number; heads: number }[] = await manager.query(
        `SELECT count(*) FILTER(WHERE v.kind<>'void')::int AS active,count(*)::int AS heads
          FROM owned_transfers t JOIN owned_transfer_versions v ON v."ownerId"=t."ownerId"
          AND v."transferId"=t.id AND v.version=t."currentVersion" WHERE t."ownerId"=$1`,
        [owner],
      );
      const rows: TransferVersionRow[] = await manager.query(
        `${transferVersionSelect} WHERE v."ownerId"=$1 AND v.version=t."currentVersion"
          ORDER BY t.id OFFSET $2 LIMIT $3`,
        [owner, query.offset, query.limit],
      );
      return {
        journalRevision,
        activeCount: counts.active,
        versionCount: journalRevision,
        limits: TRANSFER_LIMITS,
        items: rows.map(projectTransferVersion),
        nextOffset: query.offset + rows.length < counts.heads ? query.offset + rows.length : null,
      };
    });
  }

  async listVersions(ownerId: string, transferId: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const id = parseUuid(transferId);
    const query = parseTransferHistoryQuery(raw);
    return this.read(async (manager) => {
      if (!(await readTransferHead(manager, owner, id))) throw new NotFoundException();
      const rows: TransferVersionRow[] = await manager.query(
        `${transferVersionSelect} WHERE v."ownerId"=$1 AND v."transferId"=$2 AND v.version<$3
          ORDER BY v.version DESC LIMIT $4`,
        [owner, id, query.beforeVersion ?? 10001, query.limit + 1],
      );
      const items = rows.slice(0, query.limit).map(projectTransferVersion);
      return {
        items,
        nextBeforeVersion: rows.length > query.limit ? items[items.length - 1].version : null,
      };
    });
  }

  async allocation(ownerId: string, transferId: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const id = parseUuid(transferId);
    const query = parseTransferAllocationQuery(raw);
    return this.read(async (manager) => {
      const row = await readTransferHead(manager, owner, id);
      if (!row) throw new NotFoundException();
      const [from, to] = await Promise.all([
        readJournal(manager, owner, row.fromAccountId),
        readJournal(manager, owner, row.toAccountId),
      ]);
      if (!from || !to) throw conflict();
      if (
        (query.fromJournalRevision !== undefined &&
          query.fromJournalRevision !== from.currentRevision) ||
        (query.toJournalRevision !== undefined && query.toJournalRevision !== to.currentRevision)
      )
        throw conflict();
      const metadata = {
        transferId: id,
        version: row.version,
        fromJournalRevision: from.currentRevision,
        toJournalRevision: to.currentRevision,
      };
      if (row.kind === 'void')
        return {
          ...metadata,
          principalBasisUsd: '0',
          feeConsumedBasisUsd: '0',
          items: [],
          nextOffset: null,
        };
      const ledger = await readConnectedLedger(manager, owner, [row.fromAccountId]);
      const allocation = projectConnectedLedger(ledger).allocations.get(id);
      if (!allocation) throw conflict();
      const end = query.offset + query.limit;
      return {
        ...metadata,
        principalBasisUsd: allocation.principalBasisUsd,
        feeConsumedBasisUsd: allocation.feeConsumedBasisUsd,
        items: allocation.items.slice(query.offset, end),
        nextOffset: end < allocation.items.length ? end : null,
      };
    });
  }
}
