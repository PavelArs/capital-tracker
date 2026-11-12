import { ConflictException, NotFoundException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { PortfolioFlowJournal } from '../entities/portfolio-flow-journal.entity';
import type { PortfolioFlowVersion } from '../entities/portfolio-flow-version.entity';
import { PortfolioFlowService } from './portfolio-flow.service';

// Synthetic ids and amounts only. These pin the order of statements, checks and errors of the
// flow commands against a recording fake; the PostgreSQL probes carry the database evidence.
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const owner = uuid(1);
const request = uuid(0xe1);
const flowId = uuid(0xf1);
const created = new Date('2026-01-01T00:00:00.000Z');
const conflictMessage = 'Flow request conflicts with saved state';

interface State {
  journal?: PortfolioFlowJournal;
  previous?: PortfolioFlowVersion;
  heads: PortfolioFlowVersion[];
}

function label(sql: string): string {
  if (sql === 'SELECT * FROM portfolio_flow_journals WHERE "ownerId"=$1 FOR UPDATE')
    return 'journal';
  if (sql === 'SELECT * FROM portfolio_flow_versions WHERE "ownerId"=$1 AND "requestId"=$2')
    return 'previous';
  if (sql.startsWith('SELECT DISTINCT ON ("flowId") * FROM portfolio_flow_versions'))
    return 'heads';
  if (sql.startsWith('INSERT INTO portfolio_flow_versions')) return 'insert';
  if (sql === 'UPDATE portfolio_flow_journals SET "currentRevision"=$2 WHERE "ownerId"=$1')
    return 'advance';
  throw new Error(`Unexpected statement: ${sql.slice(0, 80)}`);
}

function database(state: State) {
  const log: [string, unknown[]][] = [];
  const query = async (text: string, params: unknown[] = []) => {
    const name = label(text.replace(/\s+/g, ' ').trim());
    log.push([name, params]);
    if (name === 'journal') return state.journal ? [state.journal] : [];
    if (name === 'previous') return state.previous ? [state.previous] : [];
    if (name === 'heads') return state.heads;
    if (name === 'insert') {
      const [, id, version, journalRevision, requestId, payload, kind, direction] = params;
      return [
        flowVersion({
          flowId: id as string,
          version: version as number,
          journalRevision: journalRevision as number,
          requestId: requestId as string,
          canonicalPayload: payload as string,
          kind: kind as PortfolioFlowVersion['kind'],
          direction: direction as PortfolioFlowVersion['direction'],
          occurredAt: new Date(params[8] as string),
          amountUsd: params[9] as string,
          previousVersion: params[10] as number | null,
        }),
      ];
    }
    return [];
  };
  const manager = { query } as unknown as EntityManager;
  const source = {
    transaction: async (...args: unknown[]) =>
      (args[args.length - 1] as (manager: EntityManager) => unknown)(manager),
  } as unknown as DataSource;
  return { log, service: new PortfolioFlowService(source) };
}

function journal(currentRevision: number): PortfolioFlowJournal {
  return {
    ownerId: owner,
    requestId: uuid(0xd0),
    canonicalPayload: '[]',
    coverageFrom: new Date('2025-01-01T00:00:00.000Z'),
    createdAt: created,
    currentRevision,
  } as PortfolioFlowJournal;
}

function flowVersion(overrides: Partial<PortfolioFlowVersion> = {}): PortfolioFlowVersion {
  return {
    ownerId: owner,
    flowId,
    version: 1,
    journalRevision: 1,
    requestId: uuid(0xe0),
    canonicalPayload: '[]',
    kind: 'create',
    direction: 'contribution',
    occurredAt: new Date('2025-02-01T00:00:00.000Z'),
    amountUsd: '100',
    createdAt: created,
    previousVersion: null,
    ...overrides,
  } as PortfolioFlowVersion;
}

const raw = (overrides: Record<string, unknown> = {}) => ({
  requestId: request,
  expectedJournalRevision: 1,
  direction: 'withdrawal',
  occurredAt: '2025-03-01T00:00:00.000Z',
  amountUsd: '25.5',
  assertExternal: true,
  ...overrides,
});
const createPayload = (revision = 1) =>
  JSON.stringify([
    'external-usd-command-v1',
    'create',
    null,
    revision,
    'withdrawal',
    '2025-03-01T00:00:00.000Z',
    '25.5',
    true,
  ]);
const start: [string, unknown[]][] = [
  ['journal', [owner]],
  ['previous', [owner, request]],
  ['heads', [owner]],
];

describe('FLOW-COMMAND: one flow create, correction or void (recording fake)', () => {
  it('creates a flow as the next revision of the journal', async () => {
    const { log, service } = database({ journal: journal(1), heads: [flowVersion()] });
    const result = await service.create(owner, raw());
    const id = log.find(([name]) => name === 'insert')![1][1] as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(id).not.toBe(flowId);
    expect(log).toEqual([
      ...start,
      [
        'insert',
        [
          owner,
          id,
          1,
          2,
          request,
          createPayload(),
          'create',
          'withdrawal',
          '2025-03-01T00:00:00.000Z',
          '25.5',
          null,
        ],
      ],
      ['advance', [owner, 2]],
    ]);
    expect(result).toEqual({
      created: true,
      value: {
        journalRevision: 2,
        flow: {
          flowId: id,
          version: 1,
          journalRevision: 2,
          requestId: request,
          kind: 'create',
          direction: 'withdrawal',
          occurredAt: '2025-03-01T00:00:00.000Z',
          amountUsd: '25.5',
          createdAt: created.toISOString(),
        },
      },
    });
  });

  it('corrects a flow with its new economics and the version it replaces', async () => {
    const { log, service } = database({ journal: journal(1), heads: [flowVersion()] });
    const result = await service.correct(owner, flowId, raw());
    const payload = JSON.stringify([
      'external-usd-command-v1',
      'correct',
      flowId,
      1,
      'withdrawal',
      '2025-03-01T00:00:00.000Z',
      '25.5',
      true,
    ]);
    expect(log).toEqual([
      ...start,
      [
        'insert',
        [
          owner,
          flowId,
          2,
          2,
          request,
          payload,
          'correct',
          'withdrawal',
          '2025-03-01T00:00:00.000Z',
          '25.5',
          1,
        ],
      ],
      ['advance', [owner, 2]],
    ]);
    expect(result).toMatchObject({ created: true, value: { flow: { flowId, version: 2 } } });
  });

  it('voids a flow with the economics it saved', async () => {
    const { log, service } = database({
      journal: journal(3),
      heads: [flowVersion({ version: 2, amountUsd: '100.000' })],
    });
    const voided = { requestId: request, expectedJournalRevision: 3 };
    const result = await service.void(owner, flowId, voided);
    expect(log).toEqual([
      ...start,
      [
        'insert',
        [
          owner,
          flowId,
          3,
          4,
          request,
          JSON.stringify(['external-usd-command-v1', 'void', flowId, 3]),
          'void',
          'contribution',
          '2025-02-01T00:00:00.000Z',
          '100',
          2,
        ],
      ],
      ['advance', [owner, 4]],
    ]);
    expect(result).toMatchObject({
      created: true,
      value: { journalRevision: 4, flow: { kind: 'void', version: 3, amountUsd: '100' } },
    });
  });

  it('refuses a command before the journal starts', async () => {
    const { log, service } = database({ heads: [] });
    await expect(service.create(owner, raw())).rejects.toThrow(
      new ConflictException(conflictMessage),
    );
    expect(log).toEqual(start.slice(0, 1));
  });

  it('answers a replay with the same payload from the saved version', async () => {
    const previous = flowVersion({
      requestId: request,
      canonicalPayload: createPayload(5),
      journalRevision: 6,
    });
    // A replay is answered before any later revision, target or capacity check.
    const { log, service } = database({ journal: journal(10000), previous, heads: [] });
    await expect(service.create(owner, raw({ expectedJournalRevision: 5 }))).resolves.toEqual({
      created: false,
      value: {
        journalRevision: 6,
        flow: expect.objectContaining({ flowId, requestId: request, amountUsd: '100' }),
      },
    });
    expect(log).toEqual(start.slice(0, 2));
  });

  it('refuses a replay with another payload', async () => {
    const previous = flowVersion({ requestId: request, canonicalPayload: createPayload(0) });
    const { log, service } = database({ journal: journal(1), previous, heads: [] });
    await expect(service.create(owner, raw())).rejects.toThrow(
      new ConflictException(conflictMessage),
    );
    expect(log).toEqual(start.slice(0, 2));
  });

  it('refuses a missing target', async () => {
    const { log, service } = database({ journal: journal(1), heads: [flowVersion()] });
    await expect(service.correct(owner, uuid(0xf9), raw())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(log).toEqual(start);
  });

  it.each([
    ['a voided target', { heads: [flowVersion({ kind: 'void' })] }, raw()],
    ['a stale journal revision', { heads: [flowVersion()] }, raw({ expectedJournalRevision: 0 })],
    [
      'a full journal',
      { heads: [flowVersion()], journal: journal(10000) },
      raw({ expectedJournalRevision: 10000 }),
    ],
    [
      'a date before the journal starts',
      { heads: [flowVersion()] },
      raw({ occurredAt: '2024-12-31T23:59:59.999Z' }),
    ],
  ])('refuses a correction of %s', async (_name, overrides, input) => {
    const { log, service } = database({ journal: journal(1), ...overrides });
    await expect(service.correct(owner, flowId, input)).rejects.toThrow(
      new ConflictException(conflictMessage),
    );
    expect(log).toEqual(start);
  });

  it('refuses a new flow when 1000 are active, counting no voided one', async () => {
    const heads = (voids: number) =>
      Array.from({ length: 1000 }, (_, n) =>
        flowVersion({ flowId: uuid(0x10000 + n), kind: n < voids ? 'void' : 'create' }),
      );
    const full = database({ journal: journal(1), heads: heads(0) });
    await expect(full.service.create(owner, raw())).rejects.toThrow(
      new ConflictException(conflictMessage),
    );
    expect(full.log).toEqual(start);
    const room = database({ journal: journal(1), heads: heads(1) });
    await expect(room.service.create(owner, raw())).resolves.toMatchObject({ created: true });
    const correct = database({ journal: journal(1), heads: [flowVersion(), ...heads(0)] });
    await expect(correct.service.correct(owner, flowId, raw())).resolves.toMatchObject({
      created: true,
    });
  });

  it('accepts a flow at the instant the journal starts', async () => {
    const { service } = database({ journal: journal(1), heads: [] });
    await expect(
      service.create(owner, raw({ occurredAt: '2025-01-01T00:00:00.000Z' })),
    ).resolves.toMatchObject({ created: true });
  });
});
