import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { lockAccountingOwner } from './accounting-lock';
import {
  appendSwapVersion,
  projectSwapVersion,
  readSwapCounts,
  readSwapHead,
  readSwapReplay,
  SWAP_LIMITS,
  type SwapKind,
  type SwapVersionRow,
  swapHeadJoin,
  swapReceipt,
  swapVersionSelect,
} from './asset-swap.store';
import {
  parseSwapAllocationQuery,
  parseSwapCorrection,
  parseSwapCreate,
  parseSwapHistoryQuery,
  parseSwapListQuery,
  parseSwapVoid,
  type SwapCorrectionInput,
  type SwapCreateInput,
  type SwapVoidInput,
  swapPayload,
} from './asset-swap-input';
import { emptySwapSummary, type FifoSwap } from './asset-swap-types';
import {
  advanceConnectedJournals,
  assertRevisionCapacity,
  projectConnectedLedger,
  readConnectedLedger,
  rethrowAccountingHistory,
} from './connected-accounting.store';
import { parseUuid } from './input';
import { readJournal, readOwnedAccount } from './trade-journal.store';

const conflict = () => new ConflictException('Swap request conflicts with saved state');
type SwapFields = Omit<
  FifoSwap,
  | 'swapId'
  | 'version'
  | 'outgoingInstrumentName'
  | 'outgoingInstrumentSymbol'
  | 'incomingInstrumentName'
  | 'incomingInstrumentSymbol'
>;
function fields(value: SwapFields): SwapFields {
  return {
    outgoingInstrumentId: value.outgoingInstrumentId,
    incomingInstrumentId: value.incomingInstrumentId,
    occurredAt: value.occurredAt,
    orderWithinTimestamp: value.orderWithinTimestamp,
    outgoingQuantity: value.outgoingQuantity,
    incomingQuantity: value.incomingQuantity,
    considerationUsd: value.considerationUsd,
    feeSource: value.feeSource,
    feeInstrumentId: value.feeInstrumentId,
    feeQuantity: value.feeQuantity,
  };
}

@Injectable()
export class AssetSwapService {
  constructor(private readonly source: DataSource) {}

  async create(owner: string, account: string, raw: unknown) {
    return this.mutate(parseUuid(owner), parseUuid(account), 'create', parseSwapCreate(raw));
  }
  async correct(owner: string, account: string, id: string, raw: unknown) {
    return this.mutate(
      parseUuid(owner),
      parseUuid(account),
      'correct',
      parseSwapCorrection(raw),
      parseUuid(id),
    );
  }
  async void(owner: string, account: string, id: string, raw: unknown) {
    return this.mutate(
      parseUuid(owner),
      parseUuid(account),
      'void',
      parseSwapVoid(raw),
      parseUuid(id),
    );
  }

  private async mutate(
    owner: string,
    accountId: string,
    kind: SwapKind,
    input: SwapCreateInput | SwapCorrectionInput | SwapVoidInput,
    target?: string,
  ) {
    const canonicalPayload = swapPayload(kind, input, target);
    try {
      return await this.source.transaction(async (manager) => {
        await lockAccountingOwner(manager, owner);
        const replay = await readSwapReplay(manager, owner, accountId, input.requestId);
        if (replay) {
          if (replay.canonicalPayload !== canonicalPayload) throw conflict();
          return { created: false, value: swapReceipt(replay) };
        }
        await readOwnedAccount(manager, owner, accountId);
        const row =
          target === undefined ? undefined : await readSwapHead(manager, owner, accountId, target);
        if (target !== undefined && !row) throw new NotFoundException();
        const current = row ? projectSwapVersion(row) : undefined;
        if (
          'expectedVersion' in input &&
          (current?.kind === 'void' || current?.version !== input.expectedVersion)
        )
          throw conflict();
        const values = 'outgoingQuantity' in input ? fields(input) : current && fields(current);
        if (!values) throw new Error('Swap fields required');
        const instrumentIds = [
          ...new Set([
            values.outgoingInstrumentId,
            values.incomingInstrumentId,
            ...(values.feeInstrumentId === null ? [] : [values.feeInstrumentId]),
          ]),
        ];
        const instruments: { id: string; name: string; symbol: string | null }[] =
          await manager.query(
            'SELECT id,name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=ANY($2::uuid[])',
            [owner, instrumentIds],
          );
        if (instruments.length !== instrumentIds.length) throw new NotFoundException();
        const byInstrument = new Map(instruments.map((instrument) => [instrument.id, instrument]));
        const outgoing = byInstrument.get(values.outgoingInstrumentId)!;
        const incoming = byInstrument.get(values.incomingInstrumentId)!;
        const fee =
          values.feeInstrumentId === null ? undefined : byInstrument.get(values.feeInstrumentId)!;
        const ownerCounts = await readSwapCounts(manager, owner);
        const accountCounts = await readSwapCounts(manager, owner, accountId);
        for (const counts of [ownerCounts, accountCounts]) {
          if (
            counts.versionCount >= SWAP_LIMITS.versions ||
            (kind === 'create' && counts.activeCount >= SWAP_LIMITS.activeSwaps)
          )
            throw conflict();
        }
        const ledger = await readConnectedLedger(manager, owner, [accountId], { lock: true });
        const account = ledger.accounts.get(accountId)!;
        if (account.journal.currentRevision !== input.expectedJournalRevision) throw conflict();
        assertRevisionCapacity(ledger);
        const swapId = target ?? randomUUID();
        const next = {
          ...values,
          swapId,
          version: (current?.version ?? 0) + 1,
          outgoingInstrumentName: outgoing.name,
          outgoingInstrumentSymbol: outgoing.symbol,
          incomingInstrumentName: incoming.name,
          incomingInstrumentSymbol: incoming.symbol,
          feeInstrumentName: fee?.name ?? null,
          feeInstrumentSymbol: fee?.symbol ?? null,
        };
        const swaps = (account.swaps ?? []).filter((swap) => swap.swapId !== swapId);
        if (kind !== 'void') swaps.push(next);
        projectConnectedLedger(ledger);
        projectConnectedLedger(ledger, { accountId, swaps });
        const receipt = await appendSwapVersion(manager, owner, {
          ...next,
          accountId,
          kind,
          requestId: input.requestId,
          canonicalPayload,
          journalRevision: account.journal.currentRevision + 1,
        });
        await advanceConnectedJournals(manager, owner, ledger);
        return { created: true, value: receipt };
      });
    } catch (error) {
      return rethrowAccountingHistory(error);
    }
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

  async list(ownerId: string, id: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const accountId = parseUuid(id);
    const query = parseSwapListQuery(raw);
    return this.read(async (manager) => {
      await readOwnedAccount(manager, owner, accountId);
      const journal = await readJournal(manager, owner, accountId);
      if (
        !journal ||
        (query.journalRevision !== undefined && query.journalRevision !== journal.currentRevision)
      )
        throw conflict();
      const counts = await readSwapCounts(manager, owner, accountId);
      const rows: SwapVersionRow[] = await manager.query(
        `${swapVersionSelect} ${swapHeadJoin} WHERE v."ownerId"=$1 AND v."accountId"=$2
          ORDER BY v."swapId" OFFSET $3 LIMIT $4`,
        [owner, accountId, query.offset, query.limit],
      );
      return {
        accountId,
        journalRevision: journal.currentRevision,
        activeCount: counts.activeCount,
        versionCount: counts.versionCount,
        limits: SWAP_LIMITS,
        items: rows.map(projectSwapVersion),
        nextOffset:
          query.offset + rows.length < counts.headCount ? query.offset + rows.length : null,
      };
    });
  }

  async listVersions(ownerId: string, id: string, swapId: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const accountId = parseUuid(id);
    const target = parseUuid(swapId);
    const query = parseSwapHistoryQuery(raw);
    return this.read(async (manager) => {
      await readOwnedAccount(manager, owner, accountId);
      if (!(await readSwapHead(manager, owner, accountId, target))) throw new NotFoundException();
      const rows: SwapVersionRow[] = await manager.query(
        `${swapVersionSelect} WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."swapId"=$3 AND v.version<$4
          ORDER BY v.version DESC LIMIT $5`,
        [owner, accountId, target, query.beforeVersion ?? 10001, query.limit + 1],
      );
      const items = rows.slice(0, query.limit).map(projectSwapVersion);
      return {
        items,
        nextBeforeVersion: rows.length > query.limit ? items[items.length - 1].version : null,
      };
    });
  }

  async getAllocation(ownerId: string, id: string, swapId: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const accountId = parseUuid(id);
    const target = parseUuid(swapId);
    const query = parseSwapAllocationQuery(raw);
    return this.read(async (manager) => {
      await readOwnedAccount(manager, owner, accountId);
      const row = await readSwapHead(manager, owner, accountId, target);
      if (!row) throw new NotFoundException();
      const ledger = await readConnectedLedger(manager, owner, [accountId]);
      const journalRevision = ledger.accounts.get(accountId)!.journal.currentRevision;
      if (
        (query.journalRevision !== undefined && query.journalRevision !== journalRevision) ||
        (query.expectedVersion !== undefined && query.expectedVersion !== row.version)
      )
        throw conflict();
      const projection = projectConnectedLedger(ledger);
      const { activeCount: _activeCount, ...empty } = emptySwapSummary();
      const allocation =
        row.kind === 'void'
          ? { ...empty, swapId: target, items: [] }
          : projection.swapAllocations.get(target);
      if (!allocation) throw conflict();
      const items = allocation.items.slice(query.offset, query.offset + query.limit);
      return {
        ...allocation,
        accountId,
        journalRevision,
        version: row.version,
        kind: row.kind,
        items,
        nextOffset:
          query.offset + items.length < allocation.items.length
            ? query.offset + items.length
            : null,
      };
    });
  }
}
