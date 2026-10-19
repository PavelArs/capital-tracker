import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { lockAccountingOwner } from '../accounting/accounting-lock';
import { refuseRetiredCommand } from '../accounting/retired-command';
import { moscowDate } from '../fx-rates/fx-conversion';
import { PortfolioSnapshotsService } from '../portfolio-snapshots/portfolio-snapshots.service';
import { goalForecast } from './goal-chart';
import { addMonths, MAX_MONTHS } from './goal-forecast';
import {
  type GoalPreviewInput,
  parseGoal,
  parseGoalPreview,
  parseGoalUpdate,
  parseUuid,
} from './goal-input';
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
    const at = new Date();
    return { asOf: moscowDate(at), items: await this.views(owner, rows, at) };
  }

  async get(ownerId: string, id: string) {
    const owner = parseUuid(ownerId);
    const goalId = parseUuid(id);
    const [row] = await this.rows(this.source.manager, owner, goalId);
    if (!row) throw new NotFoundException('Goal not found');
    return (await this.views(owner, [row]))[0];
  }

  /** GOAL-CHART: the goal's three return cases month by month, for the chart on its page. */
  async forecast(ownerId: string, id: string) {
    const owner = parseUuid(ownerId);
    const goalId = parseUuid(id);
    const [row] = await this.rows(this.source.manager, owner, goalId);
    if (!row) throw new NotFoundException('Goal not found');
    // One instant for the value and its day, so a read across Moscow midnight keeps them together.
    const at = new Date();
    const now = await this.snapshots.current(owner, row.currency, at);
    return goalForecast(row, now, moscowDate(at));
  }

  /** Contributions and growth use the same priced subset and exact flows as the dashboard. */
  async insights(ownerId: string, id: string) {
    const owner = parseUuid(ownerId);
    const goalId = parseUuid(id);
    const [row] = await this.rows(this.source.manager, owner, goalId);
    if (!row) throw new NotFoundException('Goal not found');
    const at = new Date();
    const history = await this.snapshots.history(
      owner,
      { period: '1Y', currency: row.currency },
      at,
    );
    const average = history.contributions.averages[6];
    const pace =
      average === null
        ? null
        : goalView(
            { ...row, monthlyContribution: average },
            { value: history.value, complete: history.complete, stalePrices: 0 },
            moscowDate(at),
          );
    return {
      currency: row.currency,
      asOf: moscowDate(at),
      complete: history.complete,
      ...history.contributions,
      paceStatus:
        average === null
          ? ('insufficient-history' as const)
          : history.value === null
            ? ('missing-value' as const)
            : pace?.scenarios.find((scenario) => scenario.key === 'base')?.reachedOn
              ? ('projected' as const)
              : ('beyond-horizon' as const),
      paceReachedOn: pace?.scenarios.find((scenario) => scenario.key === 'base')?.reachedOn ?? null,
      growth: {
        from: history.points[0]?.at ?? null,
        contributions: history.netFlow,
        market: history.marketEffect,
        total: history.change,
      },
    };
  }

  /**
   * GOAL-PREVIEW: the progress, status and return cases a goal with these terms would have now,
   * so the dialogs can show the plan while the owner types. Nothing is stored.
   */
  async preview(ownerId: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const { goalId, ...input } = parseGoalPreview(raw);
    this.checkHorizon(input);
    // For a goal being edited, a date it already has is kept as it is, as saving would keep it.
    const [stored] =
      goalId === undefined ? [] : await this.rows(this.source.manager, owner, goalId);
    if (goalId !== undefined && !stored) throw new NotFoundException('Goal not found');
    if (stored?.deadline !== input.deadline) this.checkAhead(input);
    const row: GoalRow = { id: '', name: '', createdAt: '', ...input };
    const { id, name, createdAt, ...view } = (await this.views(owner, [row]))[0];
    return view;
  }

  async create(ownerId: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const { requestId, ...input } = parseGoal(raw);
    const payload = JSON.stringify(input);
    const id = await this.source.transaction(async (manager) => {
      // One lock per owner keeps the count honest and a retry of the same request a no-op.
      await lockAccountingOwner(manager, owner);
      await refuseRetiredCommand(manager, owner, 'goal', requestId);
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
      // Only a goal that is new has to name a day still ahead; a replay answers as it did.
      this.checkAhead(input);
      this.checkHorizon(input);
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
    this.checkHorizon(input);
    await this.source.transaction(async (manager) => {
      const stored = await this.locked(manager, owner, goalId);
      // A date the goal already has stays valid on and after its day (goals-28): a name or a
      // sum can still be changed. A new or moved date has to be ahead.
      if (input.deadline !== stored.deadline) this.checkAhead(input);
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
      await manager.query(
        `INSERT INTO retired_commands ("ownerId", scope, "requestId")
         SELECT "ownerId", 'goal', "requestId" FROM savings_goals
         WHERE "ownerId"=$1 AND id=$2 ON CONFLICT DO NOTHING`,
        [owner, goalId],
      );
      await manager.query('DELETE FROM savings_goals WHERE "ownerId"=$1 AND id=$2', [
        owner,
        goalId,
      ]);
    });
    return { id: goalId };
  }

  private async locked(manager: EntityManager, owner: string, id: string) {
    await lockAccountingOwner(manager, owner);
    const [found]: { id: string; deadline: string | null }[] = await manager.query(
      `SELECT id, to_char(deadline, 'YYYY-MM-DD') AS deadline FROM savings_goals
       WHERE "ownerId"=$1 AND id=$2 FOR UPDATE`,
      [owner, id],
    );
    if (!found) throw new NotFoundException('Goal not found');
    return found;
  }

  /** A new or moved date names a Moscow day still ahead. */
  private checkAhead(input: GoalPreviewInput) {
    if (input.deadline !== null && input.deadline <= moscowDate(new Date()))
      throw new UnprocessableEntityException('The deadline must be after today');
  }

  /** Beyond this the compounding leaves the range of a number, and no plan reaches that far. */
  private checkHorizon(input: GoalPreviewInput) {
    if (input.deadline !== null && input.deadline > addMonths(moscowDate(new Date()), MAX_MONTHS))
      throw new UnprocessableEntityException('The deadline is more than 100 years away');
  }

  private rows(manager: EntityManager, owner: string, id?: string): Promise<GoalRow[]> {
    return manager.query(
      `SELECT ${columns} FROM savings_goals WHERE "ownerId"=$1 ${id ? 'AND id=$2' : ''}
       ORDER BY "createdAt", id`,
      id ? [owner, id] : [owner],
    );
  }

  /**
   * The portfolio's value once per currency the goals use, then each goal against it. Only the
   * value now matters, so the stored history is not refreshed: a preview runs on every pause in
   * typing. Every value is read for the same instant as the day the goals are dated by.
   */
  private async views(owner: string, rows: GoalRow[], at = new Date()) {
    const today = moscowDate(at);
    const now = new Map<string, PortfolioNow>();
    for (const currency of new Set(rows.map((row) => row.currency)))
      now.set(currency, await this.snapshots.current(owner, currency, at));
    return rows.map((row) => goalView(row, now.get(row.currency) as PortfolioNow, today));
  }
}
