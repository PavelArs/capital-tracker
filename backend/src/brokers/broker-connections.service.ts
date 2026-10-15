import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { REWARD_LIMITS, readRewardCounts, rewardHeadJoin } from '../accounting/asset-reward.store';
import { swapHeadJoin } from '../accounting/asset-swap.store';
import { parseCheck, parseConnection, parseUuid } from './broker-connection-input';
import {
  type TBankAccount,
  TBankClient,
  type TBankFailure,
  type TBankOperation,
  type TBankPosition,
  type TBankResult,
} from './tbank-client';
import { planImport, timeKey } from './tbank-import-plan';
import { operationKind } from './tbank-operation-kinds';
import { TBankTokenBox } from './tbank-token-box';

interface ConnectionRow {
  tokenHint: string;
  brokerAccountId: string;
  savedAt: string;
  checkedAt: string;
}

/** Why a request made with the saved token gave nothing, as the owner should hear it. */
function savedTokenFailure(reason: TBankFailure) {
  if (reason === 'token_rejected')
    return new UnprocessableEntityException(
      'T-Bank no longer accepts the saved token. Create a new read-only token and connect again.',
    );
  if (reason === 'too_many_operations')
    return new UnprocessableEntityException(
      'This T-Bank account has more operations than one read takes (50,000).',
    );
  return new ServiceUnavailableException(
    'T-Bank could not be reached. Try again in a few minutes.',
  );
}

const iso = (column: string) =>
  `to_char("${column}" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "${column}"`;

/**
 * BROKER-CONNECT: the owner's read-only T-Bank token for one broker account. The token is
 * checked with T-Bank first, stored encrypted and never returned; only its last characters and
 * the broker account it reads are shown back.
 */
@Injectable()
export class BrokerConnectionsService {
  constructor(
    private readonly source: DataSource,
    private readonly tbank: TBankClient,
    private readonly box: TBankTokenBox,
  ) {}

  /** The open broker accounts a token reaches, once it is known to be unable to trade. */
  async check(ownerId: string, accountId: string, body: unknown) {
    const owner = parseUuid(ownerId);
    const account = parseUuid(accountId);
    const input = parseCheck(body);
    await this.brokerAccount(this.source.manager, owner, account);
    const open = await this.readOnlyAccounts(input.token);
    return { accounts: open.map((item) => ({ id: item.id, name: item.name })) };
  }

  async connect(ownerId: string, accountId: string, body: unknown) {
    const owner = parseUuid(ownerId);
    const account = parseUuid(accountId);
    const input = parseConnection(body);
    const open = await this.readOnlyAccounts(input.token);
    if (!open.some((item) => item.id === input.brokerAccountId))
      throw new UnprocessableEntityException(
        'This token does not reach that T-Bank account. Pick one of the accounts it lists.',
      );
    let sealed: unknown;
    try {
      sealed = this.box.seal(input.token, owner, account);
    } catch {
      throw new ServiceUnavailableException('The token cannot be stored on this server.');
    }
    await this.source.transaction('READ COMMITTED', async (manager) => {
      await this.brokerAccount(manager, owner, account, true);
      await manager.query(
        `INSERT INTO broker_connections ("ownerId", "accountId", provider, credentials, "tokenHint",
            "brokerAccountId")
          VALUES ($1, $2, 'tbank', $3::jsonb, $4, $5)
          ON CONFLICT ("accountId") DO UPDATE SET credentials = EXCLUDED.credentials,
            "tokenHint" = EXCLUDED."tokenHint", "brokerAccountId" = EXCLUDED."brokerAccountId",
            "savedAt" = clock_timestamp(), "checkedAt" = clock_timestamp()`,
        [owner, account, JSON.stringify(sealed), input.token.slice(-4), input.brokerAccountId],
      );
    });
    return this.read(owner, account);
  }

  async read(ownerId: string, accountId: string) {
    const owner = parseUuid(ownerId);
    const account = parseUuid(accountId);
    await this.brokerAccount(this.source.manager, owner, account);
    const rows: ConnectionRow[] = await this.source.query(
      `SELECT "tokenHint", "brokerAccountId", ${iso('savedAt')}, ${iso('checkedAt')}
        FROM broker_connections WHERE "ownerId" = $1 AND "accountId" = $2`,
      [owner, account],
    );
    if (rows.length === 0) return { connected: false as const };
    return { connected: true as const, provider: 'tbank' as const, ...rows[0] };
  }

  /** What the saved token reads in the broker account now. Nothing is recorded. */
  async positions(ownerId: string, accountId: string) {
    const { token, target } = await this.savedConnection(ownerId, accountId);
    if (target.closed)
      throw new UnprocessableEntityException(
        'The saved token no longer reaches that T-Bank account. Connect it again.',
      );
    if (target.investBox)
      throw new UnprocessableEntityException(
        'T-Bank does not give positions for an Invest Box account.',
      );
    const result: TBankResult<TBankPosition[]> = await this.tbank.portfolio(token, target.id);
    if (!result.ok) throw savedTokenFailure(result.reason);
    return { positions: result.value };
  }

  /**
   * BROKER-SYNC: every operation T-Bank lists for the account and what each would become in the
   * records. Nothing is recorded. Only executed operations happened; the rest are counted. A
   * closed account still has its history, so it is read too.
   */
  async operations(ownerId: string, accountId: string) {
    const { token, target } = await this.savedConnection(ownerId, accountId);
    const result: TBankResult<TBankOperation[]> = await this.tbank.operations(token, target.id);
    if (!result.ok) throw savedTokenFailure(result.reason);
    const executed = result.value.filter((item) => item.state === 'executed');
    const operations = executed
      .map((item) => ({ ...item, kind: operationKind(item.type) }))
      .sort(
        (a, b) =>
          timeKey(a.occurredAt).localeCompare(timeKey(b.occurredAt)) || a.id.localeCompare(b.id),
      );
    const count = (keys: string[]) =>
      keys.reduce<Record<string, number>>((totals, key) => {
        totals[key] = (totals[key] ?? 0) + 1;
        return totals;
      }, {});
    return {
      operations,
      byKind: count(operations.map((item) => item.kind)),
      unsupportedTypes: count(
        operations.filter((item) => item.kind === 'unsupported').map((item) => item.type),
      ),
      notExecuted: result.value.length - executed.length,
    };
  }

  /**
   * BROKER-SYNC: the journal entries the account's T-Bank history would become, and whether the
   * app account already holds entries the import would add to. Nothing is recorded.
   */
  async importPreview(ownerId: string, accountId: string) {
    const { token, target } = await this.savedConnection(ownerId, accountId);
    const result: TBankResult<TBankOperation[]> = await this.tbank.operations(token, target.id);
    if (!result.ok) throw savedTokenFailure(result.reason);
    const owner = parseUuid(ownerId);
    const held = await this.holdsEntries(owner, parseUuid(accountId));
    const plan = planImport(result.value);
    // The reward journal's caps hold across all the owner's accounts, not only this one.
    const elsewhere = await readRewardCounts(this.source.manager, owner);
    const fitsRewardLimit =
      plan.fitsRewardLimit &&
      elsewhere.activeCount + plan.rewards <= REWARD_LIMITS.activeRewards &&
      elsewhere.versionCount + plan.rewards <= REWARD_LIMITS.versions;
    return { ...plan, fitsRewardLimit, accountHasEntries: held };
  }

  /**
   * Whether the account holds any history an import would add to: a standing trade, reward or
   * swap, a transfer in or out, an opening snapshot, a carried-in journal or any revision. A
   * voided entry no longer counts.
   */
  private async holdsEntries(owner: string, account: string) {
    const [row]: { held: boolean }[] = await this.source.query(
      `SELECT EXISTS (SELECT 1 FROM account_trade_versions v JOIN account_trades t
            ON t."ownerId" = v."ownerId" AND t."accountId" = v."accountId" AND t.id = v."tradeId"
            AND t."currentVersion" = v.version
          WHERE v."ownerId" = $1 AND v."accountId" = $2 AND v.kind <> 'void')
        OR EXISTS (SELECT 1 FROM account_reward_versions v ${rewardHeadJoin}
          WHERE v."ownerId" = $1 AND v."accountId" = $2 AND v.kind <> 'void')
        OR EXISTS (SELECT 1 FROM account_swap_versions v ${swapHeadJoin}
          WHERE v."ownerId" = $1 AND v."accountId" = $2 AND v.kind <> 'void')
        OR EXISTS (SELECT 1 FROM owned_transfers t JOIN owned_transfer_versions v
            ON v."ownerId" = t."ownerId" AND v."transferId" = t.id AND v.version = t."currentVersion"
          WHERE t."ownerId" = $1 AND $2 IN (t."fromAccountId", t."toAccountId")
            AND v.kind <> 'void')
        OR EXISTS (SELECT 1 FROM account_opening_snapshots WHERE "ownerId" = $1 AND "accountId" = $2)
        OR EXISTS (SELECT 1 FROM account_trade_journals
          WHERE "ownerId" = $1 AND "accountId" = $2 AND "originKind" <> 'declared-empty')
        OR EXISTS (SELECT 1 FROM manual_accounts
          WHERE "ownerId" = $1 AND id = $2 AND "currentRevision" IS NOT NULL) AS held`,
      [owner, account],
    );
    return row.held;
  }

  async disconnect(ownerId: string, accountId: string) {
    const owner = parseUuid(ownerId);
    const account = parseUuid(accountId);
    await this.brokerAccount(this.source.manager, owner, account);
    await this.source.query(
      'DELETE FROM broker_connections WHERE "ownerId" = $1 AND "accountId" = $2',
      [owner, account],
    );
  }

  /**
   * The saved token, opened, and the T-Bank account it was saved for as T-Bank lists it now. The
   * account's type and status are not stored, so they are asked for each time.
   */
  private async savedConnection(ownerId: string, accountId: string) {
    const owner = parseUuid(ownerId);
    const account = parseUuid(accountId);
    await this.brokerAccount(this.source.manager, owner, account);
    const rows: { credentials: unknown; brokerAccountId: string }[] = await this.source.query(
      `SELECT credentials, "brokerAccountId" FROM broker_connections
        WHERE "ownerId" = $1 AND "accountId" = $2`,
      [owner, account],
    );
    if (rows.length === 0) throw new NotFoundException('No T-Bank connection for this account');
    const token = this.box.open(rows[0].credentials, owner, account);
    if (token === null)
      throw new ServiceUnavailableException('The saved token cannot be opened on this server.');
    const listed: TBankResult<TBankAccount[]> = await this.tbank.accounts(token);
    if (!listed.ok) throw savedTokenFailure(listed.reason);
    const target = listed.value.find((item) => item.id === rows[0].brokerAccountId);
    if (!target || target.access === 'no_access')
      throw new UnprocessableEntityException(
        'The saved token no longer reaches that T-Bank account. Connect it again.',
      );
    return { token, target };
  }

  /** The owner's live broker account, or 404 (also for another owner's and for a wallet). */
  private async brokerAccount(manager: EntityManager, owner: string, id: string, lock = false) {
    const rows: { id: string }[] = await manager.query(
      `SELECT id FROM manual_accounts
        WHERE "ownerId" = $1 AND id = $2 AND "assetClass" = 'broker' AND "removedAt" IS NULL
        ${lock ? 'FOR UPDATE' : ''}`,
      [owner, id],
    );
    if (rows.length === 0) throw new NotFoundException('Broker account not found');
  }

  private async readOnlyAccounts(token: string): Promise<TBankAccount[]> {
    const result: TBankResult<TBankAccount[]> = await this.tbank.accounts(token);
    if (!result.ok) {
      if (result.reason === 'token_rejected')
        throw new UnprocessableEntityException(
          'T-Bank did not accept this token. Check that it was copied in full.',
        );
      throw new ServiceUnavailableException(
        'T-Bank could not be reached. Try again in a few minutes.',
      );
    }
    // A token able to trade on any account that is not closed is refused, including one still
    // being opened: it can trade there once it opens. An account the token has no access to
    // cannot be traded with, so it neither blocks the token nor can be picked.
    const live = result.value.filter((item) => !item.closed && item.access !== 'no_access');
    if (live.some((item) => item.access !== 'read_only'))
      throw new UnprocessableEntityException(
        'This token can trade. Create a read-only token in T-Bank Investments and paste that one.',
      );
    const open = live.filter((item) => item.open);
    if (open.length === 0)
      throw new UnprocessableEntityException('This token reaches no open T-Bank account.');
    return open;
  }
}
