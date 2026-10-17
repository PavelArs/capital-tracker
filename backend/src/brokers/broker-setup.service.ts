import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { insertAccount } from '../accounting/accounting.service';
import { lockAccountingOwner } from '../accounting/accounting-lock';
import { parseCheck, parseSetup, parseUuid } from './broker-connection-input';
import { BrokerConnectionsService } from './broker-connections.service';
import { TBankTokenBox } from './tbank-token-box';

/**
 * BROKER-SETUP: one read-only T-Bank token turns into a broker account for each T-Bank account
 * the owner picks, each connected and ready to read. It is one idempotent command: the accounts
 * are made under the client's request ids, so a repeat returns them and writes nothing. A T-Bank account that is already connected is never given a second broker account, which
 * would count its history twice.
 */
@Injectable()
export class BrokerSetupService {
  constructor(
    private readonly source: DataSource,
    private readonly connections: BrokerConnectionsService,
    private readonly box: TBankTokenBox,
  ) {}

  /** The open T-Bank accounts a read-only token reaches, and which are already connected. Nothing is stored. */
  async accounts(ownerId: string, body: unknown) {
    const owner = parseUuid(ownerId);
    const input = parseCheck(body);
    const open = await this.connections.reachableAccounts(input.token);
    const linked: { brokerAccountId: string }[] = await this.source.query(
      `SELECT "brokerAccountId" FROM broker_connections
        WHERE "ownerId" = $1 AND provider = 'tbank' AND "brokerAccountId" = ANY($2::text[])`,
      [owner, open.map((item) => item.id)],
    );
    const connected = new Set(linked.map((row) => row.brokerAccountId));
    return {
      accounts: open.map((item) => ({
        id: item.id,
        name: item.name,
        investBox: item.investBox,
        connected: connected.has(item.id),
      })),
    };
  }

  async connect(ownerId: string, body: unknown) {
    const owner = parseUuid(ownerId);
    const input = parseSetup(body);
    // A retry of a command that already finished needs nothing from T-Bank: it is answered from
    // what is saved, so a lost answer is recoverable while T-Bank is down or the token is revoked.
    const finished = await this.finished(owner, input.accounts);
    if (finished) return { connections: finished };
    const open = await this.connections.reachableAccounts(input.token);
    const reached = new Set(open.map((item) => item.id));
    if (!input.accounts.every((item) => reached.has(item.brokerAccountId)))
      throw new UnprocessableEntityException(
        'This token does not reach one of those T-Bank accounts. Pick from the accounts it lists.',
      );
    const connections = await this.source.transaction('READ COMMITTED', async (manager) => {
      await lockAccountingOwner(manager, owner);
      const made: { accountId: string; name: string; brokerAccountId: string; created: boolean }[] =
        [];
      for (const pick of input.accounts) {
        const { created, value } = await insertAccount(manager, owner, {
          requestId: pick.requestId,
          name: pick.name,
          assetClass: 'broker',
        });
        if (!created) {
          // A repeated request writes nothing: it returns the account it made while that account
          // is still live and still reads the same T-Bank account, so a replay can neither store
          // a token on a removed account nor re-point or restore a connection the owner changed.
          const [saved]: { brokerAccountId: string; removedAt: Date | null }[] =
            await manager.query(
              `SELECT c."brokerAccountId", a."removedAt"
                 FROM manual_accounts a
                 LEFT JOIN broker_connections c ON c."accountId" = a.id AND c.provider = 'tbank'
                WHERE a.id = $1 AND a."ownerId" = $2`,
              [value.id, owner],
            );
          if (!saved || saved.removedAt || saved.brokerAccountId !== pick.brokerAccountId)
            throw new ConflictException('This request conflicts with what is saved now');
          made.push({
            accountId: value.id,
            name: value.name,
            brokerAccountId: pick.brokerAccountId,
            created,
          });
          continue;
        }
        const [elsewhere]: { accountId: string }[] = await manager.query(
          `SELECT "accountId" FROM broker_connections
            WHERE "ownerId" = $1 AND provider = 'tbank' AND "brokerAccountId" = $2
              AND "accountId" <> $3`,
          [owner, pick.brokerAccountId, value.id],
        );
        if (elsewhere)
          throw new ConflictException('A T-Bank account is already connected to another account');
        let sealed: unknown;
        try {
          sealed = this.box.seal(input.token, owner, value.id);
        } catch {
          throw new ServiceUnavailableException('The token cannot be stored on this server.');
        }
        await manager.query(
          `INSERT INTO broker_connections ("ownerId", "accountId", provider, credentials, "tokenHint",
              "brokerAccountId")
            VALUES ($1, $2, 'tbank', $3::jsonb, $4, $5)
            ON CONFLICT ("accountId") DO NOTHING`,
          [owner, value.id, JSON.stringify(sealed), input.token.slice(-4), pick.brokerAccountId],
        );
        made.push({
          accountId: value.id,
          name: value.name,
          brokerAccountId: pick.brokerAccountId,
          created,
        });
      }
      return made;
    });
    return { connections };
  }

  /**
   * The connections of a command whose every pick was already made, live and still reading its
   * T-Bank account, or null when any pick still needs work (or conflicts, which the command then
   * reports as it does for a first request).
   */
  private async finished(
    owner: string,
    picks: { brokerAccountId: string; requestId: string; name: string }[],
  ) {
    const rows: {
      requestId: string;
      id: string;
      name: string;
      canonicalPayload: string;
      removedAt: Date | null;
      brokerAccountId: string | null;
    }[] = await this.source.query(
      `SELECT a."requestId", a.id, a.name, a."canonicalPayload", a."removedAt", c."brokerAccountId"
         FROM manual_accounts a
         LEFT JOIN broker_connections c ON c."accountId" = a.id AND c.provider = 'tbank'
        WHERE a."ownerId" = $1 AND a."requestId" = ANY($2::uuid[])`,
      [owner, picks.map((pick) => pick.requestId)],
    );
    const saved = new Map(rows.map((row) => [row.requestId, row]));
    const made: { accountId: string; name: string; brokerAccountId: string; created: false }[] = [];
    for (const pick of picks) {
      const row = saved.get(pick.requestId);
      // The payload is the one insertAccount saves for this pick, so a changed name is not a repeat.
      if (
        !row ||
        row.removedAt ||
        row.brokerAccountId !== pick.brokerAccountId ||
        row.canonicalPayload !== JSON.stringify({ name: pick.name, assetClass: 'broker' })
      )
        return null;
      made.push({
        accountId: row.id,
        name: row.name,
        brokerAccountId: pick.brokerAccountId,
        created: false,
      });
    }
    return made;
  }
}
