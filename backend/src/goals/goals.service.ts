import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { moscowDate } from '../fx-rates/fx-conversion';
import { PortfolioSnapshotsService } from '../portfolio-snapshots/portfolio-snapshots.service';
import { addMonths, MAX_MONTHS } from './goal-forecast';
import { type GoalInput, parseGoal, parseGoalUpdate, parseUuid } from './goal-input';
import { type GoalRow, goalView, type PortfolioNow } from './goal-view';

/** The most goals one owner keeps; a personal list never needs more. */
export const MAX_GOALS = 20;

const columns = `id, name, currency, "targetAmount"::text AS "targetAmount",
  to_char(deadline, 'YYYY-MM-DD') AS deadline,
  trim(trailing '.' FROM trim(trailing '0' FROM "expectedReturnPercent"::text)) AS "expectedReturnPercent",
  "monthlyContribution"::text AS "monthlyContribution",
  to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"`;

/**
 * GOAL-TERMS, GOAL-FORECAST: savings goals the owner entered once, measured against the whole
 * portfolio. Progress and the return cases are computed on every read.
 */
@Injectable()
export class GoalsService {
  constructor(
    private readonly source: DataSource,
    private readonly snapshots: PortfolioSnapshotsService,
  ) {}

  async list(ownerId: string) {
    const owner = parseUuid(ownerId);
    const rows = await this.rows(this.source.manager, owner);
    return { asOf: moscowDate(new Date()), items: await this.views(owner, rows) };
  }

  async get(ownerId: string, id: string) {
    const owner = parseUuid(ownerId);
    const goalId = parseUuid(id);
    const [row] = await this.rows(this.source.manager, owner, goalId);
    if (!row) throw new NotFoundException('Goal not found');
    return (await this.views(owner, [row]))[0];
  }

  async create(ownerId: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const { requestId, ...input } = parseGoal(raw);
    this.checkDeadline(input);
    const payload = JSON.stringify(input);
    const id = await this.source.transaction(async (manager) => {
      // One lock per owner keeps the count honest and a retry of the same request a no-op.
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `savings-goals:${owner}`,
      ]);
      const [earlier]: { id: string; canonicalPayload: string }[] = await manager.query(
        'SELECT id, "canonicalPayload" FROM savings_goals WHERE "ownerId"=$1 AND "requestId"=$2',
        [owner, requestId],
      );
      if (earlier) {
        // The same request again, e.g. a retry after a lost answer: the goal it made.
        if (earlier.canonicalPayload !== payload)
          throw new ConflictException('This request was already used for a different goal');
        return earlier.id;
      }
      const [{ count }]: { count: string }[] = await manager.query(
        'SELECT count(*) AS count FROM savings_goals WHERE "ownerId"=$1',
        [owner],
      );
      if (Number(count) >= MAX_GOALS)
        throw new UnprocessableEntityException(`At most ${MAX_GOALS} goals can be kept`);
      const goalId = randomUUID();
      await manager.query(
        `INSERT INTO savings_goals (id, "ownerId", "requestId", "canonicalPayload", name, currency,
           "targetAmount", deadline, "expectedReturnPercent", "monthlyContribution")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          goalId,
          owner,
          requestId,
          payload,
          input.name,
          input.currency,
          input.targetAmount,
          input.deadline,
          input.expectedReturnPercent,
          input.monthlyContribution,
        ],
      );
      return goalId;
    });
    return this.get(owner, id);
  }

  async update(ownerId: string, id: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const goalId = parseUuid(id);
    const input = parseGoalUpdate(raw);
    this.checkDeadline(input);
    await this.source.transaction(async (manager) => {
      await this.locked(manager, owner, goalId);
      await manager.query(
        `UPDATE savings_goals SET name=$3, currency=$4, "targetAmount"=$5, deadline=$6,
           "expectedReturnPercent"=$7, "monthlyContribution"=$8, "updatedAt"=now()
         WHERE "ownerId"=$1 AND id=$2`,
        [
          owner,
          goalId,
          input.name,
          input.currency,
          input.targetAmount,
          input.deadline,
          input.expectedReturnPercent,
          input.monthlyContribution,
        ],
      );
    });
    return this.get(owner, goalId);
  }

  async remove(ownerId: string, id: string) {
    const owner = parseUuid(ownerId);
    const goalId = parseUuid(id);
    await this.source.transaction(async (manager) => {
      await this.locked(manager, owner, goalId);
      await manager.query('DELETE FROM savings_goals WHERE "ownerId"=$1 AND id=$2', [
        owner,
        goalId,
      ]);
    });
    return { id: goalId };
  }

  private async locked(manager: EntityManager, owner: string, id: string) {
    const found: { id: string }[] = await manager.query(
      'SELECT id FROM savings_goals WHERE "ownerId"=$1 AND id=$2 FOR UPDATE',
      [owner, id],
    );
    if (found.length === 0) throw new NotFoundException('Goal not found');
  }

  private checkDeadline(input: GoalInput) {
    const today = moscowDate(new Date());
    if (input.deadline !== null && input.deadline <= today)
      throw new UnprocessableEntityException('The deadline must be after today');
    // Beyond this the compounding leaves the range of a number, and no plan reaches that far.
    if (input.deadline !== null && input.deadline > addMonths(today, MAX_MONTHS))
      throw new UnprocessableEntityException('The deadline is more than 100 years away');
  }

  private rows(manager: EntityManager, owner: string, id?: string): Promise<GoalRow[]> {
    return manager.query(
      `SELECT ${columns} FROM savings_goals WHERE "ownerId"=$1 ${id ? 'AND id=$2' : ''}
       ORDER BY "createdAt", id`,
      id ? [owner, id] : [owner],
    );
  }

  /** The portfolio's value once per currency the goals use, then each goal against it. */
  private async views(owner: string, rows: GoalRow[]) {
    const today = moscowDate(new Date());
    const now = new Map<string, PortfolioNow>();
    for (const currency of new Set(rows.map((row) => row.currency))) {
      const history = await this.snapshots.history(owner, { period: '24H', currency });
      // The last point is the portfolio now; an hour in the past that lacked a price is not.
      const current = history.points.at(-1);
      now.set(currency, { value: history.value, complete: current?.complete ?? history.complete });
    }
    return rows.map((row) => goalView(row, now.get(row.currency) as PortfolioNow, today));
  }
}
