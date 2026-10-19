import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { lockAccountingOwner } from '../accounting/accounting-lock';
import { parseCheck, parseConnection, parseUuid } from './broker-connection-input';
import {
  type TBankAccount,
  TBankClient,
  type TBankFailure,
  type TBankOperation,
  type TBankPosition,
  type TBankResult,
} from './tbank-client';
import { timeKey } from './tbank-import-plan';
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

  async check(ownerId: string, accountId: string, body: unknown) {
    const owner = parseUuid(ownerId);
    const account = parseUuid(accountId);
    const input = parseCheck(body);
    await this.brokerAccount(this.source.manager, owner, account);
    const open = await this.reachableAccounts(input.token);
    return { accounts: open.map((item) => ({ id: item.id, name: item.name })) };
  }

  async connect(ownerId: string, accountId: string, body: unknown) {
    const owner = parseUuid(ownerId);
    const account = parseUuid(accountId);
    const input = parseConnection(body);
    const open = await this.reachableAccounts(input.token);
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
      // The same lock and check as BROKER-SETUP: one T-Bank account reads into one broker account,
      // or its history would count twice.
      await lockAccountingOwner(manager, owner);
      await this.brokerAccount(manager, owner, account, true);
      const [elsewhere]: { accountId: string }[] = await manager.query(
        `SELECT "accountId" FROM broker_connections
          WHERE "ownerId" = $1 AND provider = 'tbank' AND "brokerAccountId" = $2
            AND "accountId" <> $3`,
        [owner, input.brokerAccountId, account],
      );
      if (elsewhere)
        throw new ConflictException('A T-Bank account is already connected to another account');
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
    const { operations: listed } = await this.history(ownerId, accountId);
    const executed = listed.filter((item) => item.state === 'executed');
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
      notExecuted: listed.length - executed.length,
    };
  }

  /**
   * BROKER-SYNC: the account's whole operation history as T-Bank lists it, read with the saved
   * token, and the T-Bank account it was read from.
   */
  async history(
    ownerId: string,
    accountId: string,
    includePositions = false,
  ): Promise<{
    brokerAccountId: string;
    operations: TBankOperation[];
    positions?: TBankPosition[];
  }> {
    const { token, target } = await this.savedConnection(ownerId, accountId);
    const result: TBankResult<TBankOperation[]> = await this.tbank.operations(token, target.id);
    if (!result.ok) throw savedTokenFailure(result.reason);
    if (!includePositions) return { brokerAccountId: target.id, operations: result.value };
    if (target.closed || target.investBox)
      throw new UnprocessableEntityException(
        'T-Bank cannot verify current holdings for this account. Reconcile it before importing.',
      );
    const positions = await this.tbank.portfolio(token, target.id);
    if (!positions.ok) throw savedTokenFailure(positions.reason);
    return { brokerAccountId: target.id, operations: result.value, positions: positions.value };
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

  /** The open broker accounts a token reaches, once it is known to be unable to trade. */
  async reachableAccounts(token: string): Promise<TBankAccount[]> {
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
