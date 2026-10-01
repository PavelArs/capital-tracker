import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { Opening } from './accounting.service';
import {
  type CarryInLotInput,
  type CarryInPreviewInput,
  parseCarryInInitialization,
  parseCarryInLotsQuery,
  parseCarryInPreview,
} from './carry-in-input';
import { type CarryInOrigin, projectCarryInOrigin } from './carry-in-projections';
import { deriveCarryInAmounts } from './fifo';
import { parseUuid } from './input';
import { canonicalDecimalToAtoms, formatAtoms } from './money';
import { readOpening } from './opening.store';
import {
  type JournalRow,
  readBaseline,
  readJournal,
  readOwnedAccount,
} from './trade-journal.store';

interface InstrumentRow {
  id: string;
  name: string;
  symbol: string | null;
}
type IssueCode =
  | 'acquisition-after-coverage'
  | 'extra-instrument'
  | 'missing-instrument'
  | 'quantity-mismatch'
  | 'cost-mismatch';
interface CarryInIssue {
  code: IssueCode;
  instrumentId: string | null;
  ordinal: number | null;
}
interface PreviewLot extends CarryInLotInput {
  ordinal: number;
  instrumentName: string;
  instrumentSymbol: string | null;
  priorDisposedQuantity: string;
  priorAllocatedCostUsd: string;
  carriedCostUsd: string;
}
interface Reconciliation {
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  openingQuantity: string | null;
  openingCostUsd: string | null;
  carriedQuantity: string;
  carriedCostUsd: string;
}
export interface CarryInPreview {
  accountId: string;
  openingRevision: number;
  coverageFrom: string;
  canInitialize: boolean;
  issues: CarryInIssue[];
  lots: PreviewLot[];
  reconciliation: Reconciliation[];
  carryInCostUsd: string;
}
export interface CarryInState {
  accountId: string;
  eligible: boolean;
  ineligibilityReason: 'already-initialized' | 'no-current-opening' | 'unknown-cost' | null;
  opening: Opening | null;
  origin: CarryInOrigin | null;
}
const conflict = () => new ConflictException('Carry-in request conflicts with saved state');
const known = (opening: Opening) =>
  opening.positions.every(
    (position) => position.costStatus === 'known' && position.totalCostUsd !== null,
  );

@Injectable()
export class CarryInService {
  constructor(private readonly source: DataSource) {}

  async state(ownerId: string, accountId: string): Promise<CarryInState> {
    const owner = parseUuid(ownerId);
    const id = parseUuid(accountId);
    return this.readOnly(async (manager) => {
      const account = await readOwnedAccount(manager, owner, id);
      const journal = await readJournal(manager, owner, id);
      const revision =
        journal?.originKind === 'known-cost-carry-in'
          ? journal.openingRevision
          : account.currentRevision;
      const opening = revision === null ? null : await readOpening(manager, owner, id, revision);
      let origin: CarryInOrigin | null = null;
      if (journal?.originKind === 'known-cost-carry-in') {
        if (!opening) throw new Error('Invalid saved carry-in opening');
        origin = projectCarryInOrigin(journal, await readBaseline(manager, owner, id, journal));
      }
      const reason = journal
        ? 'already-initialized'
        : !opening
          ? 'no-current-opening'
          : !known(opening)
            ? 'unknown-cost'
            : null;
      return {
        accountId: id,
        eligible: reason === null,
        ineligibilityReason: reason,
        opening,
        origin,
      };
    });
  }

  async preview(ownerId: string, accountId: string, raw: unknown): Promise<CarryInPreview> {
    const owner = parseUuid(ownerId);
    const id = parseUuid(accountId);
    const input = parseCarryInPreview(raw);
    return this.readOnly(async (manager) => {
      const account = await readOwnedAccount(manager, owner, id);
      if (await readJournal(manager, owner, id)) throw conflict();
      return this.evaluate(manager, owner, id, account.currentRevision, input);
    });
  }

  async initialize(
    ownerId: string,
    accountId: string,
    raw: unknown,
  ): Promise<{ created: boolean; value: CarryInOrigin }> {
    const owner = parseUuid(ownerId);
    const id = parseUuid(accountId);
    const input = parseCarryInInitialization(raw);
    const payload = JSON.stringify([
      'ct-known-cost-carry-in-v1',
      input.expectedOpeningRevision,
      true,
      input.lots.map((lot) => [
        lot.instrumentId,
        lot.acquiredAt,
        lot.orderWithinTimestamp,
        lot.originalQuantity,
        lot.originalCostUsd,
        lot.remainingQuantity,
      ]),
    ]);
    return this.source.transaction(async (manager) => {
      const account = await readOwnedAccount(manager, owner, id, true);
      const previous = await readJournal(manager, owner, id);
      if (previous) {
        if (
          previous.originKind !== 'known-cost-carry-in' ||
          previous.requestId !== input.requestId ||
          previous.canonicalPayload !== payload
        )
          throw conflict();
        return {
          created: false,
          value: projectCarryInOrigin(previous, await readBaseline(manager, owner, id, previous)),
        };
      }
      const preview = await this.evaluate(manager, owner, id, account.currentRevision, input);
      if (!preview.canInitialize) throw conflict();
      const [journal]: JournalRow[] = await manager.query(
        `INSERT INTO account_trade_journals
        ("ownerId","accountId","requestId","canonicalPayload","originKind","coverageFrom","openingRevision","currentRevision")
        VALUES ($1,$2,$3,$4,'known-cost-carry-in',$5,$6,0) RETURNING *`,
        [owner, id, input.requestId, payload, preview.coverageFrom, input.expectedOpeningRevision],
      );
      if (journal.originKind !== 'known-cost-carry-in')
        throw new Error('Invalid saved carry-in origin');
      for (const lot of preview.lots) {
        await manager.query(
          `INSERT INTO account_carry_in_lots
          (id,"ownerId","accountId","openingRevision",ordinal,"instrumentId","acquiredAt","orderWithinTimestamp","originalQuantity","originalCostUsd","remainingQuantity")
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            randomUUID(),
            owner,
            id,
            input.expectedOpeningRevision,
            lot.ordinal,
            lot.instrumentId,
            lot.acquiredAt,
            lot.orderWithinTimestamp,
            lot.originalQuantity,
            lot.originalCostUsd,
            lot.remainingQuantity,
          ],
        );
      }
      return {
        created: true,
        value: projectCarryInOrigin(journal, await readBaseline(manager, owner, id, journal)),
      };
    });
  }

  async listLots(ownerId: string, accountId: string, rawQuery: unknown = {}) {
    const owner = parseUuid(ownerId);
    const id = parseUuid(accountId);
    const query = parseCarryInLotsQuery(rawQuery);
    return this.readOnly(async (manager) => {
      await readOwnedAccount(manager, owner, id);
      const journal = await readJournal(manager, owner, id);
      if (journal?.originKind !== 'known-cost-carry-in') throw conflict();
      const baseline = await readBaseline(manager, owner, id, journal);
      const remaining = baseline.filter((lot) => lot.ordinal > query.afterOrdinal);
      const items = remaining.slice(0, query.limit).map((lot) => ({
        lotId: lot.lotId,
        ordinal: lot.ordinal,
        instrumentId: lot.instrumentId,
        instrumentName: lot.instrumentName,
        instrumentSymbol: lot.instrumentSymbol,
        acquiredAt: lot.acquiredAt,
        orderWithinTimestamp: lot.orderWithinTimestamp,
        originalQuantity: lot.originalQuantity,
        originalCostUsd: lot.originalCostUsd,
        carriedQuantity: lot.carriedQuantity,
        ...deriveCarryInAmounts(lot.originalQuantity, lot.originalCostUsd, lot.carriedQuantity),
      }));
      return {
        accountId: id,
        openingRevision: journal.openingRevision,
        items,
        nextAfterOrdinal: remaining.length > query.limit ? items[items.length - 1].ordinal : null,
      };
    });
  }

  private readOnly<T>(read: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      return read(manager);
    });
  }

  private async evaluate(
    manager: EntityManager,
    owner: string,
    id: string,
    currentRevision: number | null,
    input: CarryInPreviewInput,
  ): Promise<CarryInPreview> {
    if (currentRevision !== input.expectedOpeningRevision) throw conflict();
    const ids = [...new Set(input.lots.map((lot) => lot.instrumentId))];
    const instruments: InstrumentRow[] = await manager.query(
      'SELECT id,name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=ANY($2::uuid[])',
      [owner, ids],
    );
    if (instruments.length !== ids.length) throw new NotFoundException();
    const labels = new Map(instruments.map((row) => [row.id, row]));
    const opening = await readOpening(manager, owner, id, input.expectedOpeningRevision);
    if (!opening || !known(opening)) throw conflict();
    const issues: CarryInIssue[] = [];
    const totals = new Map<string, { quantity: bigint; cost: bigint }>();
    const lots: PreviewLot[] = input.lots.map((lot, index) => {
      const ordinal = index + 1;
      const label = labels.get(lot.instrumentId)!;
      const amounts = deriveCarryInAmounts(
        lot.originalQuantity,
        lot.originalCostUsd,
        lot.remainingQuantity,
      );
      if (lot.acquiredAt > opening.asOf)
        issues.push({ code: 'acquisition-after-coverage', instrumentId: null, ordinal });
      const total = totals.get(lot.instrumentId) ?? { quantity: 0n, cost: 0n };
      total.quantity += canonicalDecimalToAtoms(lot.remainingQuantity);
      total.cost += canonicalDecimalToAtoms(amounts.carriedCostUsd);
      totals.set(lot.instrumentId, total);
      return {
        ...lot,
        ordinal,
        instrumentName: label.name,
        instrumentSymbol: label.symbol,
        ...amounts,
      };
    });
    const positions = new Map(
      opening.positions.map((position) => [position.instrumentId, position]),
    );
    const union = [...new Set([...positions.keys(), ...totals.keys()])].sort();
    const reconciliation: Reconciliation[] = union.map((instrumentId) => {
      const position = positions.get(instrumentId);
      const label = labels.get(instrumentId);
      const total = totals.get(instrumentId);
      return {
        instrumentId,
        instrumentName: position?.instrumentName ?? label!.name,
        instrumentSymbol: position ? position.instrumentSymbol : label!.symbol,
        openingQuantity: position?.quantity ?? null,
        openingCostUsd: position?.totalCostUsd ?? null,
        carriedQuantity: formatAtoms(total?.quantity ?? 0n),
        carriedCostUsd: formatAtoms(total?.cost ?? 0n),
      };
    });
    for (const code of [
      'extra-instrument',
      'missing-instrument',
      'quantity-mismatch',
      'cost-mismatch',
    ] as const) {
      for (const row of reconciliation) {
        const exists = positions.has(row.instrumentId);
        const supplied = totals.has(row.instrumentId);
        const matches =
          code === 'extra-instrument'
            ? !exists
            : code === 'missing-instrument'
              ? !supplied
              : exists &&
                supplied &&
                (code === 'quantity-mismatch'
                  ? row.openingQuantity !== row.carriedQuantity
                  : row.openingCostUsd !== row.carriedCostUsd);
        if (matches) issues.push({ code, instrumentId: row.instrumentId, ordinal: null });
      }
    }
    return {
      accountId: id,
      openingRevision: input.expectedOpeningRevision,
      coverageFrom: opening.asOf,
      canInitialize: issues.length === 0,
      issues,
      lots,
      reconciliation,
      carryInCostUsd: formatAtoms(
        [...totals.values()].reduce((sum, total) => sum + total.cost, 0n),
      ),
    };
  }
}
