import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { parseCheck, parseConnection, parseUuid } from './broker-connection-input';
import {
  type TBankAccount,
  TBankClient,
  type TBankFailure,
  type TBankPosition,
  type TBankResult,
} from './tbank-client';
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
    // The account's type is not stored, so ask for it: T-Bank gives no portfolio for an Invest
    // Box, and retrying would never help.
    const listed: TBankResult<TBankAccount[]> = await this.tbank.accounts(token);
    if (!listed.ok) throw savedTokenFailure(listed.reason);
    const target = listed.value.find((item) => item.id === rows[0].brokerAccountId);
    if (!target || target.closed || target.access === 'no_access')
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

  async disconnect(ownerId: string, accountId: string) {
    const owner = parseUuid(ownerId);
    const account = parseUuid(accountId);
    await this.brokerAccount(this.source.manager, owner, account);
    await this.source.query(
      'DELETE FROM broker_connections WHERE "ownerId" = $1 AND "accountId" = $2',
      [owner, account],
    );
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
