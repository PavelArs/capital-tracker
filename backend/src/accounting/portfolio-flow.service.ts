import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { PortfolioFlowJournal } from '../entities/portfolio-flow-journal.entity';
import type { PortfolioFlowVersion } from '../entities/portfolio-flow-version.entity';
import { parseDecimal, parseUuid } from './input';
import { parseProfitPreview, projectPeriodProfit } from './period-profit';
import { type FlowVersion, projectFlowPeriod } from './portfolio-flow';
import {
  type FlowCreate,
  type FlowVoid,
  parseFlowCreate,
  parseFlowInitialization,
  parseFlowPeriod,
  parseFlowVoid,
} from './portfolio-flow-input';
import { parseTradeHistoryQuery } from './trade-input';

const basis = { basis: 'owner-declared-usd-flows' as const, completeness: 'unreconciled' as const };
const conflict = () => new ConflictException('Flow request conflicts with saved state');

function origin(row: PortfolioFlowJournal) {
  return {
    requestId: row.requestId,
    coverageFrom: row.coverageFrom.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
function project(row: PortfolioFlowVersion): FlowVersion {
  return {
    flowId: row.flowId,
    version: row.version,
    journalRevision: row.journalRevision,
    requestId: row.requestId,
    kind: row.kind,
    direction: row.direction,
    occurredAt: row.occurredAt.toISOString(),
    amountUsd: parseDecimal(row.amountUsd, true),
    createdAt: row.createdAt.toISOString(),
  };
}
function receipt(row: PortfolioFlowVersion) {
  return { journalRevision: row.journalRevision, flow: project(row) };
}

@Injectable()
export class PortfolioFlowService {
  constructor(private readonly source: DataSource) {}

  async initialize(ownerId: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const input = parseFlowInitialization(raw);
    const payload = JSON.stringify(['external-usd-origin-v1', input.coverageFrom, true]);
    return this.source.transaction(async (manager) => {
      const inserted: PortfolioFlowJournal[] = await manager.query(
        `INSERT INTO portfolio_flow_journals ("ownerId","requestId","canonicalPayload","coverageFrom")
         VALUES ($1,$2,$3,$4) ON CONFLICT ("ownerId") DO NOTHING RETURNING *`,
        [owner, input.requestId, payload, input.coverageFrom],
      );
      const row = await this.journal(manager, owner, true);
      if (!row || row.requestId !== input.requestId || row.canonicalPayload !== payload)
        throw conflict();
      return { created: inserted.length === 1, value: origin(row) };
    });
  }

  create(ownerId: string, raw: unknown) {
    return this.mutate(parseUuid(ownerId), 'create', undefined, parseFlowCreate(raw));
  }
  correct(ownerId: string, flowId: string, raw: unknown) {
    return this.mutate(parseUuid(ownerId), 'correct', parseUuid(flowId), parseFlowCreate(raw));
  }
  void(ownerId: string, flowId: string, raw: unknown) {
    return this.mutate(parseUuid(ownerId), 'void', parseUuid(flowId), parseFlowVoid(raw));
  }

  private async mutate(
    owner: string,
    kind: FlowVersion['kind'],
    target: string | undefined,
    input: FlowCreate | FlowVoid,
  ) {
    const fields = kind === 'void' ? undefined : (input as FlowCreate);
    const payload = JSON.stringify([
      'external-usd-command-v1',
      kind,
      target ?? null,
      input.expectedJournalRevision,
      ...(fields ? [fields.direction, fields.occurredAt, fields.amountUsd, true] : []),
    ]);
    return this.source.transaction(async (manager) => {
      const journal = await this.journal(manager, owner, true);
      if (!journal) throw conflict();
      const [previous]: PortfolioFlowVersion[] = await manager.query(
        'SELECT * FROM portfolio_flow_versions WHERE "ownerId"=$1 AND "requestId"=$2',
        [owner, input.requestId],
      );
      // Saved commands precede mutable revision, target state, coverage and capacity.
      if (previous) {
        if (previous.canonicalPayload !== payload) throw conflict();
        return { created: false, value: receipt(previous) };
      }
      const heads = await this.heads(manager, owner);
      const current = target === undefined ? undefined : heads.find((row) => row.flowId === target);
      if (target !== undefined && !current) throw new NotFoundException();
      if (
        current?.kind === 'void' ||
        journal.currentRevision !== input.expectedJournalRevision ||
        journal.currentRevision >= 10000 ||
        (kind === 'create' && heads.filter((row) => row.kind !== 'void').length >= 1000)
      )
        throw conflict();
      const economics = fields ?? current;
      if (!economics) throw new NotFoundException();
      if (economics.occurredAt < journal.coverageFrom.toISOString()) throw conflict();
      const nextVersion = (current?.version ?? 0) + 1;
      const nextRevision = journal.currentRevision + 1;
      const [saved]: PortfolioFlowVersion[] = await manager.query(
        `INSERT INTO portfolio_flow_versions
         ("ownerId","flowId",version,"journalRevision","requestId","canonicalPayload",kind,
          direction,"occurredAt","amountUsd","previousVersion")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [
          owner,
          target ?? randomUUID(),
          nextVersion,
          nextRevision,
          input.requestId,
          payload,
          kind,
          economics.direction,
          economics.occurredAt,
          economics.amountUsd,
          current?.version ?? null,
        ],
      );
      await manager.query(
        'UPDATE portfolio_flow_journals SET "currentRevision"=$2 WHERE "ownerId"=$1',
        [owner, nextRevision],
      );
      return { created: true, value: receipt(saved) };
    });
  }

  async getJournal(ownerId: string) {
    const owner = parseUuid(ownerId);
    return this.read(async (manager) => {
      const journal = await this.journal(manager, owner);
      if (!journal) return { journal: null, ...basis };
      const heads = await this.heads(manager, owner);
      return {
        journal: {
          ...origin(journal),
          journalRevision: journal.currentRevision,
          activeFlowCount: heads.filter((row) => row.kind !== 'void').length,
          versionCount: journal.currentRevision,
          limits: { activeFlows: 1000, versions: 10000 },
        },
        ...basis,
      };
    });
  }

  async list(ownerId: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const query = parseFlowPeriod(raw);
    return this.read(async (manager) => {
      const { journal, summary, items } = await this.period(manager, owner, query);
      const end = query.offset + query.limit;
      return {
        from: query.from,
        to: query.to,
        coverageFrom: journal.coverageFrom.toISOString(),
        journalRevision: journal.currentRevision,
        ...basis,
        summary,
        items: items.slice(query.offset, end),
        nextOffset: end < items.length ? end : null,
      };
    });
  }

  async previewProfit(ownerId: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const input = parseProfitPreview(raw);
    return this.read(async (manager) => {
      const { journal, summary } = await this.period(manager, owner, input);
      return {
        from: input.from,
        to: input.to,
        coverageFrom: journal.coverageFrom.toISOString(),
        journalRevision: journal.currentRevision,
        basis: 'manual-usd-valuations' as const,
        flowBasis: basis.basis,
        completeness: basis.completeness,
        openingValueUsd: input.openingValueUsd,
        closingValueUsd: input.closingValueUsd,
        flows: summary,
        profitUsd: projectPeriodProfit(input.openingValueUsd, input.closingValueUsd, summary),
      };
    });
  }

  async versions(ownerId: string, flowId: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const id = parseUuid(flowId);
    const query = parseTradeHistoryQuery(raw);
    return this.read(async (manager) => {
      if (!(await this.journal(manager, owner))) throw conflict();
      const [exists]: PortfolioFlowVersion[] = await manager.query(
        'SELECT * FROM portfolio_flow_versions WHERE "ownerId"=$1 AND "flowId"=$2 AND version=1',
        [owner, id],
      );
      if (!exists) throw new NotFoundException();
      const rows: PortfolioFlowVersion[] = await manager.query(
        `SELECT * FROM portfolio_flow_versions WHERE "ownerId"=$1 AND "flowId"=$2
         AND version<$3 ORDER BY version DESC LIMIT $4`,
        [owner, id, query.beforeVersion ?? 10001, query.limit + 1],
      );
      const items = rows.slice(0, query.limit).map(project);
      return {
        flowId: id,
        items,
        nextBeforeVersion: rows.length > query.limit ? items[items.length - 1].version : null,
      };
    });
  }

  private async period(
    manager: EntityManager,
    owner: string,
    query: { from: string; to: string; journalRevision?: number },
  ) {
    const journal = await this.journal(manager, owner);
    if (
      !journal ||
      query.from < journal.coverageFrom.toISOString() ||
      (query.journalRevision !== undefined && query.journalRevision !== journal.currentRevision)
    )
      throw conflict();
    return {
      journal,
      ...projectFlowPeriod(await this.heads(manager, owner), query.from, query.to),
    };
  }

  private async journal(manager: EntityManager, owner: string, lock = false) {
    const [row]: PortfolioFlowJournal[] = await manager.query(
      `SELECT * FROM portfolio_flow_journals WHERE "ownerId"=$1${lock ? ' FOR UPDATE' : ''}`,
      [owner],
    );
    return row;
  }
  private async heads(manager: EntityManager, owner: string) {
    const rows: PortfolioFlowVersion[] = await manager.query(
      `SELECT DISTINCT ON ("flowId") * FROM portfolio_flow_versions WHERE "ownerId"=$1
       ORDER BY "flowId",version DESC`,
      [owner],
    );
    return rows.map(project);
  }
  private read<T>(operation: (manager: EntityManager) => Promise<T>) {
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      return operation(manager);
    });
  }
}
