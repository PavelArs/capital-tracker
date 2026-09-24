import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { lockAccountingOwner } from './accounting-lock';
import {
  type ConnectedLedger,
  advanceConnectedJournals,
  assertRevisionCapacity,
  projectConnectedLedger,
  readConnectedLedger,
  rethrowAccountingHistory,
} from './connected-accounting.store';
import {
  parseCsvConfirm,
  parseCsvInspect,
  parseCsvListQuery,
  parseCsvPreview,
  parseCsvRollback,
  parseCsvRowsQuery,
  validateCsvSource,
  validateDisplayName,
} from './csv-input';
import { type CsvIssue, normalizeCsvRows, parseCsvSource } from './csv-parser';
import { type Execution, FifoHistoryError, type FifoSummary, type FifoTrade } from './fifo';
import { parseUuid } from './input';
import { OwnedTransferCapacityError } from './owned-transfer-fifo';
import {
  type JournalRow,
  type TradeVersion,
  type VersionRow,
  appendTradeVersion,
  projectTradeVersion,
  readJournal,
  readOwnedAccount,
  readTradeHeads,
  versionSelect,
} from './trade-journal.store';

type Settings = ReturnType<typeof parseCsvPreview>;
type ConfirmInput = ReturnType<typeof parseCsvConfirm>;
type RollbackInput = ReturnType<typeof parseCsvRollback>;
type BatchState = 'draft' | 'committed' | 'rolled-back';
type CommandKind = 'confirm' | 'rollback';
interface BatchRow {
  id: string;
  ownerId: string;
  accountId: string;
  sha256: string;
  byteLength: number;
  filename: string;
  state: BatchState;
  createdAt: Date;
  acceptedSettings: (Settings & { parserVersion: string }) | null;
  originalBytes?: Buffer;
}
interface CommandRow {
  ownerId: string;
  accountId: string;
  batchId: string;
  requestId: string;
  kind: CommandKind;
  canonicalPayload: string;
  rowCount: number;
  firstJournalRevision: number;
  lastJournalRevision: number;
  createdAt: Date;
}
interface LinkRow {
  ordinal: number;
  startLine: number;
  tradeId: string;
  createVersion: number;
  rollbackVersion: number | null;
}
interface Instrument {
  id: string;
  name: string;
  symbol: string | null;
}

const PARSER_VERSION = 'usd-csv-v1';
const batchColumns =
  'id,"ownerId","accountId",sha256,"byteLength",filename,state,"acceptedSettings","createdAt"';
const conflict = () => new ConflictException('CSV request conflicts with saved state');
const invalid = () => new BadRequestException('Invalid CSV data');
function uploadIdentity(row: BatchRow) {
  return {
    batchId: row.id,
    sha256: row.sha256,
    byteLength: row.byteLength,
    createdAt: row.createdAt.toISOString(),
  };
}
function metadata(row: BatchRow) {
  return {
    ...uploadIdentity(row),
    accountId: row.accountId,
    filename: row.filename,
    state: row.state,
  };
}
function receipt(row: CommandRow) {
  return {
    accountId: row.accountId,
    batchId: row.batchId,
    requestId: row.requestId,
    kind: row.kind,
    rowCount: row.rowCount,
    firstJournalRevision: row.firstJournalRevision,
    lastJournalRevision: row.lastJournalRevision,
    createdAt: row.createdAt.toISOString(),
  };
}
function execution(value: Execution): Execution {
  return {
    instrumentId: value.instrumentId,
    side: value.side,
    occurredAt: value.occurredAt,
    orderWithinTimestamp: value.orderWithinTimestamp,
    quantity: value.quantity,
    grossUsd: value.grossUsd,
    feeUsd: value.feeUsd,
  };
}
function executionTuple(value: Execution) {
  return [
    value.instrumentId,
    value.side,
    value.occurredAt,
    value.orderWithinTimestamp,
    value.quantity,
    value.grossUsd,
    value.feeUsd,
  ];
}
function tuples(settings: Settings) {
  const { format, mapping } = settings;
  const c = mapping.columns;
  return {
    format: [
      format.delimiter,
      format.decimalSeparator,
      format.timestampMode,
      format.fixedOffset ?? null,
    ],
    mapping: [
      [
        c.instrument,
        c.side,
        c.occurredAt,
        c.order,
        c.quantity,
        c.grossUsd,
        c.feeUsd,
        c.currency ?? null,
      ],
      mapping.instruments.map((v) => [v.source, v.instrumentId]),
      mapping.sides.map((v) => [v.source, v.side]),
    ],
  };
}
function canonical(
  kind: CommandKind,
  batchId: string,
  input: ConfirmInput | RollbackInput,
): string {
  if (kind === 'rollback')
    return JSON.stringify(['usd-csv-command-v1', kind, batchId, input.expectedJournalRevision]);
  const value = input as ConfirmInput;
  const settings = tuples(value);
  return JSON.stringify([
    'usd-csv-command-v1',
    kind,
    batchId,
    value.expectedJournalRevision,
    value.parserVersion,
    settings.format,
    settings.mapping,
    true,
    value.previewHash,
  ]);
}
function sourceBytes(batch: BatchRow): Buffer {
  if (!Buffer.isBuffer(batch.originalBytes)) throw new Error('CSV source unavailable');
  return batch.originalBytes;
}
function active(heads: TradeVersion[]) {
  return heads.filter((h) => h.kind !== 'void');
}

@Injectable()
export class CsvImportService {
  constructor(private readonly source: DataSource) {}

  async upload(ownerId: string, accountId: string, input: { filename: unknown; bytes: unknown }) {
    const owner = parseUuid(ownerId);
    const id = parseUuid(accountId);
    if (!input || typeof input !== 'object') throw invalid();
    const filename = validateDisplayName(input.filename);
    const bytes = validateCsvSource(input.bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    return this.source.transaction(async (manager) => {
      await readOwnedAccount(manager, owner, id, true);
      await this.journal(manager, owner, id);
      const [previous]: BatchRow[] = await manager.query(
        `SELECT ${batchColumns},"originalBytes" FROM account_csv_imports WHERE "ownerId"=$1 AND "accountId"=$2 AND sha256=$3`,
        [owner, id, sha256],
      );
      if (previous) {
        if (!sourceBytes(previous).equals(bytes)) throw conflict();
        return { created: false, value: uploadIdentity(previous) };
      }
      const [quota]: { count: string; bytes: string }[] = await manager.query(
        'SELECT count(*)::text AS count,COALESCE(sum("byteLength"),0)::text AS bytes FROM account_csv_imports WHERE "ownerId"=$1 AND "accountId"=$2',
        [owner, id],
      );
      if (Number(quota.count) >= 256 || Number(quota.bytes) + bytes.length > 67108864)
        throw conflict();
      const [saved]: BatchRow[] = await manager.query(
        `INSERT INTO account_csv_imports
        (id,"ownerId","accountId",sha256,"originalBytes","byteLength",filename,state,"acceptedSettings","createdAt")
        VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',NULL,clock_timestamp()) RETURNING ${batchColumns}`,
        [randomUUID(), owner, id, sha256, bytes, bytes.length, filename],
      );
      return { created: true, value: uploadIdentity(saved) };
    });
  }

  async inspect(ownerId: string, accountId: string, batchId: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const id = parseUuid(accountId);
    const target = parseUuid(batchId);
    const input = parseCsvInspect(raw);
    return this.read(async (manager) => {
      await readOwnedAccount(manager, owner, id);
      const batch = await this.batch(manager, owner, id, target, true);
      return { batchId: target, ...parseCsvSource(sourceBytes(batch), input.delimiter) };
    });
  }

  async preview(ownerId: string, accountId: string, batchId: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const id = parseUuid(accountId);
    const target = parseUuid(batchId);
    const settings = parseCsvPreview(raw);
    return this.read(async (manager) => {
      await readOwnedAccount(manager, owner, id);
      const journal = await this.journal(manager, owner, id);
      const batch = await this.batch(manager, owner, id, target, true);
      if (batch.state !== 'draft') throw conflict();
      const heads = await readTradeHeads(manager, owner, id);
      return (await this.evaluate(manager, owner, id, batch, settings, journal, heads)).view;
    });
  }

  async confirm(ownerId: string, accountId: string, batchId: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const id = parseUuid(accountId);
    const target = parseUuid(batchId);
    const input = parseCsvConfirm(raw);
    const payload = canonical('confirm', target, input);
    return this.source
      .transaction(async (manager) => {
        await lockAccountingOwner(manager, owner);
        await readOwnedAccount(manager, owner, id);
        const replay = await this.replay(manager, owner, id, input.requestId, payload);
        if (replay) return { created: false, value: replay };
        const ledger = await readConnectedLedger(manager, owner, [id], { lock: true });
        const journal = ledger.accounts.get(id)!.journal;
        const batch = await this.batch(manager, owner, id, target, true);
        if (
          batch.state !== 'draft' ||
          input.parserVersion !== PARSER_VERSION ||
          journal.currentRevision !== input.expectedJournalRevision
        )
          throw conflict();
        const heads = await readTradeHeads(manager, owner, id);
        const { view, instruments } = await this.evaluate(
          manager,
          owner,
          id,
          batch,
          input,
          journal,
          heads,
          ledger,
        );
        if (
          view.rowErrors.length ||
          view.batchErrors.some(
            (e) =>
              ![
                'before-coverage',
                'duplicate-chronology',
                'active-trade-cap',
                'version-cap',
                'insufficient-holdings',
                'connected-history',
                'connected-capacity',
              ].includes(e.code),
          )
        )
          throw invalid();
        if (!view.canConfirm || view.previewHash !== input.previewHash) throw conflict();
        const rows = view.rows;
        for (const row of rows) {
          if (!row.execution) throw new Error('Missing validated CSV execution');
          const fields = execution(row.execution);
          const instrument = instruments.get(fields.instrumentId);
          if (!instrument) throw new Error('Missing validated CSV instrument');
          const tradeId = randomUUID();
          const requestId = randomUUID();
          const revision = journal.currentRevision + row.ordinal;
          await appendTradeVersion(manager, owner, id, {
            ...fields,
            tradeId,
            requestId,
            version: 1,
            journalRevision: revision,
            kind: 'create',
            instrumentName: instrument.name,
            instrumentSymbol: instrument.symbol,
            canonicalPayload: JSON.stringify({
              kind: 'create',
              expectedJournalRevision: revision - 1,
              ...fields,
            }),
          });
          await manager.query(
            'INSERT INTO account_csv_import_rows ("ownerId","accountId","batchId",ordinal,"startLine","tradeId","createVersion","rollbackVersion") VALUES ($1,$2,$3,$4,$5,$6,1,NULL)',
            [owner, id, target, row.ordinal, row.startLine, tradeId],
          );
        }
        const settings: Settings = {
          format: input.format,
          mapping: input.mapping,
          assertUsd: true,
        };
        await manager.query(
          'UPDATE account_csv_imports SET state=\'committed\',"acceptedSettings"=$4::jsonb WHERE "ownerId"=$1 AND "accountId"=$2 AND id=$3',
          [owner, id, target, JSON.stringify({ parserVersion: PARSER_VERSION, ...settings })],
        );
        await advanceConnectedJournals(manager, owner, ledger, id, rows.length);
        const saved = await this.command(
          manager,
          owner,
          id,
          target,
          'confirm',
          input.requestId,
          payload,
          rows.length,
          journal.currentRevision,
        );
        return { created: true, value: receipt(saved) };
      })
      .catch(rethrowAccountingHistory);
  }

  async rollback(ownerId: string, accountId: string, batchId: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const id = parseUuid(accountId);
    const target = parseUuid(batchId);
    const input = parseCsvRollback(raw);
    const payload = canonical('rollback', target, input);
    return this.source
      .transaction(async (manager) => {
        await lockAccountingOwner(manager, owner);
        await readOwnedAccount(manager, owner, id);
        const replay = await this.replay(manager, owner, id, input.requestId, payload);
        if (replay) return { created: false, value: replay };
        const ledger = await readConnectedLedger(manager, owner, [id], { lock: true });
        const journal = ledger.accounts.get(id)!.journal;
        const batch = await this.batch(manager, owner, id, target);
        if (journal.currentRevision !== input.expectedJournalRevision) throw conflict();
        const heads = await readTradeHeads(manager, owner, id);
        const links = await this.links(manager, owner, id, target);
        const review = this.rollbackReview(batch, journal, heads, links, ledger, id);
        if (!review.eligible) throw conflict();
        for (const link of links) {
          const original = heads.find((h) => h.tradeId === link.tradeId);
          if (!original) throw new Error('Missing validated import head');
          const revision = journal.currentRevision + link.ordinal;
          await appendTradeVersion(manager, owner, id, {
            ...execution(original),
            tradeId: original.tradeId,
            version: 2,
            journalRevision: revision,
            requestId: randomUUID(),
            kind: 'void',
            instrumentName: original.instrumentName,
            instrumentSymbol: original.instrumentSymbol,
            canonicalPayload: JSON.stringify({
              kind: 'void',
              tradeId: original.tradeId,
              expectedJournalRevision: revision - 1,
            }),
          });
          await manager.query(
            'UPDATE account_csv_import_rows SET "rollbackVersion"=2 WHERE "ownerId"=$1 AND "accountId"=$2 AND "batchId"=$3 AND ordinal=$4',
            [owner, id, target, link.ordinal],
          );
        }
        await manager.query(
          'UPDATE account_csv_imports SET state=\'rolled-back\' WHERE "ownerId"=$1 AND "accountId"=$2 AND id=$3',
          [owner, id, target],
        );
        await advanceConnectedJournals(manager, owner, ledger, id, links.length);
        const saved = await this.command(
          manager,
          owner,
          id,
          target,
          'rollback',
          input.requestId,
          payload,
          links.length,
          journal.currentRevision,
        );
        return { created: true, value: receipt(saved) };
      })
      .catch(rethrowAccountingHistory);
  }

  async list(ownerId: string, accountId: string, raw: unknown = {}) {
    const owner = parseUuid(ownerId);
    const id = parseUuid(accountId);
    const query = parseCsvListQuery(raw);
    return this.read(async (manager) => {
      await readOwnedAccount(manager, owner, id);
      await this.journal(manager, owner, id);
      const rows: BatchRow[] = await manager.query(
        `SELECT ${batchColumns} FROM account_csv_imports WHERE "ownerId"=$1 AND "accountId"=$2 AND ($3::uuid IS NULL OR id>$3) ORDER BY id LIMIT $4`,
        [owner, id, query.cursor ?? null, query.limit + 1],
      );
      const items = rows.slice(0, query.limit).map(metadata);
      return {
        items,
        nextCursor: rows.length > query.limit ? items[items.length - 1].batchId : null,
      };
    });
  }

  async detail(ownerId: string, accountId: string, batchId: string) {
    const owner = parseUuid(ownerId);
    const id = parseUuid(accountId);
    const target = parseUuid(batchId);
    return this.read(async (manager) => {
      await readOwnedAccount(manager, owner, id);
      const journal = await this.journal(manager, owner, id);
      const batch = await this.batch(manager, owner, id, target);
      const commands: CommandRow[] = await manager.query(
        'SELECT * FROM account_csv_import_commands WHERE "ownerId"=$1 AND "accountId"=$2 AND "batchId"=$3',
        [owner, id, target],
      );
      const heads = await readTradeHeads(manager, owner, id);
      const ledger = await readConnectedLedger(manager, owner, [id]);
      const links = await this.links(manager, owner, id, target);
      const confirmed = commands.find((c) => c.kind === 'confirm');
      const rolledBack = commands.find((c) => c.kind === 'rollback');
      return {
        batch: metadata(batch),
        acceptedSettings: batch.acceptedSettings,
        confirmReceipt: confirmed ? receipt(confirmed) : null,
        rollbackReceipt: rolledBack ? receipt(rolledBack) : null,
        rollbackReview: this.rollbackReview(batch, journal, heads, links, ledger, id),
      };
    });
  }

  async rows(ownerId: string, accountId: string, batchId: string, raw: unknown = {}) {
    const owner = parseUuid(ownerId);
    const id = parseUuid(accountId);
    const target = parseUuid(batchId);
    const query = parseCsvRowsQuery(raw);
    return this.read(async (manager) => {
      await readOwnedAccount(manager, owner, id);
      const batch = await this.batch(manager, owner, id, target);
      if (query.batchState !== undefined && query.batchState !== batch.state) throw conflict();
      const links: LinkRow[] = await manager.query(
        'SELECT ordinal,"startLine","tradeId","createVersion","rollbackVersion" FROM account_csv_import_rows WHERE "ownerId"=$1 AND "accountId"=$2 AND "batchId"=$3 AND ordinal>$4 ORDER BY ordinal LIMIT $5',
        [owner, id, target, query.afterOrdinal, query.limit + 1],
      );
      const selected = links.slice(0, query.limit);
      const versions: VersionRow[] = selected.length
        ? await manager.query(
            `${versionSelect} JOIN account_csv_import_rows r ON r."ownerId"=v."ownerId" AND r."accountId"=v."accountId" AND r."tradeId"=v."tradeId" AND (v.version=r."createVersion" OR v.version=r."rollbackVersion") WHERE r."ownerId"=$1 AND r."accountId"=$2 AND r."batchId"=$3 AND r."tradeId"=ANY($4::uuid[])`,
            [owner, id, target, selected.map((r) => r.tradeId)],
          )
        : [];
      const items = selected.map((link) => {
        const created = versions.find(
          (v) => v.tradeId === link.tradeId && v.version === link.createVersion,
        );
        const rolledBack =
          link.rollbackVersion === null
            ? null
            : versions.find(
                (v) => v.tradeId === link.tradeId && v.version === link.rollbackVersion,
              );
        if (!created || (link.rollbackVersion !== null && !rolledBack))
          throw new Error('Incomplete CSV provenance');
        return {
          ordinal: link.ordinal,
          startLine: link.startLine,
          tradeId: link.tradeId,
          createVersion: projectTradeVersion(created),
          rollbackVersion: rolledBack ? projectTradeVersion(rolledBack) : null,
        };
      });
      return {
        batchId: target,
        batchState: batch.state,
        items,
        nextAfterOrdinal: links.length > query.limit ? items[items.length - 1].ordinal : null,
      };
    });
  }

  private async evaluate(
    manager: EntityManager,
    owner: string,
    id: string,
    batch: BatchRow,
    settings: Settings,
    journal: JournalRow,
    heads: TradeVersion[],
    loadedLedger?: ConnectedLedger,
  ) {
    const ids = [...new Set(settings.mapping.instruments.map((m) => m.instrumentId))];
    const owned: Instrument[] = await manager.query(
      'SELECT id,name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=ANY($2::uuid[])',
      [owner, ids],
    );
    if (owned.length !== ids.length) throw new NotFoundException();
    const instruments = new Map(owned.map((i) => [i.id, i]));
    const ledger = loadedLedger ?? (await readConnectedLedger(manager, owner, [id]));
    const summaryBefore = projectConnectedLedger(ledger).accounts.get(id)!.summary;
    const document = parseCsvSource(sourceBytes(batch), settings.format.delimiter);
    const normalized = document.valid
      ? normalizeCsvRows(document, settings)
      : { rows: [], rowErrors: [], ignoredColumns: [], batchErrors: [document.error] };
    const batchErrors: CsvIssue[] = [...normalized.batchErrors];
    let candidateSummary: FifoSummary | null = null;
    if (!normalized.rowErrors.length && !batchErrors.length) {
      const added: FifoTrade[] = normalized.rows.map((row) => {
        if (!row.execution) throw new Error('Missing normalized CSV execution');
        const instrument = instruments.get(row.execution.instrumentId);
        if (!instrument) throw new Error('Missing CSV instrument');
        return {
          ...row.execution,
          tradeId: `csv:${batch.id}:${row.ordinal}`,
          version: 1,
          instrumentName: instrument.name,
          instrumentSymbol: instrument.symbol,
        };
      });
      const candidate = [...active(heads), ...added];
      const add = (code: CsvIssue['code']) => batchErrors.push({ code, line: null, column: null });
      if (added.some((t) => t.occurredAt < journal.coverageFrom.toISOString()))
        add('before-coverage');
      const chronology = new Set<string>();
      let duplicate = false;
      for (const trade of candidate) {
        const key = JSON.stringify([trade.occurredAt, trade.orderWithinTimestamp]);
        if (chronology.has(key)) duplicate = true;
        chronology.add(key);
      }
      if (duplicate) add('duplicate-chronology');
      if (candidate.length > 1000) add('active-trade-cap');
      if (journal.currentRevision + added.length > 10000) add('version-cap');
      if (!duplicate && candidate.length <= 1000) {
        try {
          assertRevisionCapacity(ledger, id, added.length);
          candidateSummary = projectConnectedLedger(ledger, {
            accountId: id,
            trades: candidate,
          }).accounts.get(id)!.summary;
        } catch (error) {
          if (error instanceof OwnedTransferCapacityError) add('connected-capacity');
          else if (error instanceof FifoHistoryError)
            add(ledger.transfers.length ? 'connected-history' : 'insufficient-holdings');
          else throw error;
        }
      }
    }
    const canConfirm = normalized.rowErrors.length === 0 && batchErrors.length === 0;
    const tuple = tuples(settings);
    const previewHash = canConfirm
      ? createHash('sha256')
          .update(
            JSON.stringify([
              'usd-csv-preview-v1',
              PARSER_VERSION,
              id,
              batch.id,
              batch.sha256,
              tuple.format,
              tuple.mapping,
              true,
              normalized.rows.map((row) => [
                row.ordinal,
                row.startLine,
                row.execution ? executionTuple(row.execution) : null,
              ]),
              journal.currentRevision,
            ]),
            'utf8',
          )
          .digest('hex')
      : null;
    return {
      instruments,
      view: {
        batchId: batch.id,
        parserVersion: PARSER_VERSION,
        journalRevision: journal.currentRevision,
        canConfirm,
        rows: normalized.rows,
        ignoredColumns: normalized.ignoredColumns,
        rowErrors: normalized.rowErrors,
        batchErrors,
        summaryBefore,
        candidateSummary: canConfirm ? candidateSummary : null,
        previewHash,
      },
    };
  }

  private rollbackReview(
    batch: BatchRow,
    journal: JournalRow,
    heads: TradeVersion[],
    links: LinkRow[],
    ledger: ConnectedLedger,
    id: string,
  ) {
    const current = active(heads);
    const summaryBefore = projectConnectedLedger(ledger).accounts.get(id)!.summary;
    let reason:
      | 'not-committed'
      | 'modified-trade'
      | 'version-cap'
      | 'insufficient-holdings'
      | 'connected-history'
      | 'connected-capacity'
      | null = null;
    let summaryAfter: FifoSummary | null = null;
    if (batch.state !== 'committed') reason = 'not-committed';
    else if (
      links.some(
        (link) =>
          !heads.some(
            (head) => head.tradeId === link.tradeId && head.version === 1 && head.kind === 'create',
          ),
      )
    )
      reason = 'modified-trade';
    else if (journal.currentRevision + links.length > 10000) reason = 'version-cap';
    else {
      const removed = new Set(links.map((l) => l.tradeId));
      try {
        assertRevisionCapacity(ledger, id, links.length);
        summaryAfter = projectConnectedLedger(ledger, {
          accountId: id,
          trades: current.filter((h) => !removed.has(h.tradeId)),
        }).accounts.get(id)!.summary;
      } catch (error) {
        if (error instanceof OwnedTransferCapacityError) reason = 'connected-capacity';
        else if (error instanceof FifoHistoryError)
          reason = ledger.transfers.length ? 'connected-history' : 'insufficient-holdings';
        else throw error;
      }
    }
    return {
      journalRevision: journal.currentRevision,
      eligible: reason === null,
      reason,
      removedTradeCount: batch.state === 'committed' ? links.length : 0,
      additionalVersionCount: batch.state === 'committed' ? links.length : 0,
      summaryBefore,
      summaryAfter,
    };
  }
  private read<T>(run: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      return run(manager).catch(rethrowAccountingHistory);
    });
  }
  private async journal(manager: EntityManager, owner: string, id: string) {
    const value = await readJournal(manager, owner, id);
    if (!value) throw conflict();
    return value;
  }
  private async batch(
    manager: EntityManager,
    owner: string,
    id: string,
    target: string,
    bytes = false,
  ): Promise<BatchRow> {
    const [row]: BatchRow[] = await manager.query(
      `SELECT ${batchColumns}${bytes ? ',"originalBytes"' : ''} FROM account_csv_imports WHERE "ownerId"=$1 AND "accountId"=$2 AND id=$3`,
      [owner, id, target],
    );
    if (!row) throw new NotFoundException();
    return row;
  }
  private async links(
    manager: EntityManager,
    owner: string,
    id: string,
    target: string,
  ): Promise<LinkRow[]> {
    return manager.query(
      'SELECT ordinal,"startLine","tradeId","createVersion","rollbackVersion" FROM account_csv_import_rows WHERE "ownerId"=$1 AND "accountId"=$2 AND "batchId"=$3 ORDER BY ordinal',
      [owner, id, target],
    );
  }
  private async replay(
    manager: EntityManager,
    owner: string,
    id: string,
    requestId: string,
    payload: string,
  ) {
    const [row]: CommandRow[] = await manager.query(
      'SELECT * FROM account_csv_import_commands WHERE "ownerId"=$1 AND "accountId"=$2 AND "requestId"=$3',
      [owner, id, requestId],
    );
    if (!row) return null;
    if (row.canonicalPayload !== payload) throw conflict();
    return receipt(row);
  }
  private async command(
    manager: EntityManager,
    owner: string,
    id: string,
    batchId: string,
    kind: CommandKind,
    requestId: string,
    payload: string,
    count: number,
    revision: number,
  ): Promise<CommandRow> {
    const [row]: CommandRow[] = await manager.query(
      `INSERT INTO account_csv_import_commands ("ownerId","accountId","batchId",kind,"requestId","canonicalPayload","rowCount","firstJournalRevision","lastJournalRevision","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp()) RETURNING *`,
      [owner, id, batchId, kind, requestId, payload, count, revision + 1, revision + count],
    );
    return row;
  }
}
