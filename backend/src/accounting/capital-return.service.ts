import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { lockAccountingOwner } from './accounting-lock';
import {
  appendCapitalReturnVersion,
  CAPITAL_RETURN_LIMITS,
  capitalReturnReceipt,
  projectCapitalReturnVersion,
  readCapitalReturnCounts,
  readCapitalReturnHead,
  readCapitalReturnReplay,
} from './capital-return.store';
import {
  advanceConnectedJournals,
  assertRevisionCapacity,
  projectConnectedLedger,
  readConnectedLedger,
  rethrowAccountingHistory,
} from './connected-accounting.store';
import { parseUuid } from './input';
import { parseTradeVoid } from './trade-input';
import { readOwnedAccount } from './trade-journal.store';

const conflict = () => new ConflictException('Capital return request conflicts with saved state');

/** A void takes one version from the owner and from the account; the owner is counted first. */
async function assertVersionCapacity(manager: EntityManager, owner: string, account: string) {
  for (const scope of [undefined, account]) {
    const counts = await readCapitalReturnCounts(manager, owner, scope);
    if (counts.versionCount >= CAPITAL_RETURN_LIMITS.versions) throw conflict();
  }
}

@Injectable()
export class CapitalReturnService {
  constructor(private readonly source: DataSource) {}

  async void(ownerId: string, accountId: string, returnId: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const account = parseUuid(accountId);
    const target = parseUuid(returnId);
    const input = parseTradeVoid(raw);
    const canonicalPayload = JSON.stringify({
      kind: 'void',
      capitalReturnId: target,
      expectedJournalRevision: input.expectedJournalRevision,
    });
    try {
      return await this.source.transaction(async (manager) => {
        await lockAccountingOwner(manager, owner);
        const replay = await readCapitalReturnReplay(manager, owner, account, input.requestId);
        if (replay) {
          if (replay.canonicalPayload !== canonicalPayload) throw conflict();
          return { created: false, value: capitalReturnReceipt(replay) };
        }
        await readOwnedAccount(manager, owner, account);
        const row = await readCapitalReturnHead(manager, owner, account, target);
        if (!row) throw new NotFoundException();
        if (row.kind === 'void') throw conflict();
        await assertVersionCapacity(manager, owner, account);
        const ledger = await readConnectedLedger(manager, owner, [account], { lock: true });
        const held = ledger.accounts.get(account)!;
        if (held.journal.currentRevision !== input.expectedJournalRevision) throw conflict();
        assertRevisionCapacity(ledger);
        projectConnectedLedger(ledger);
        projectConnectedLedger(ledger, {
          accountId: account,
          capitalReturns: (held.capitalReturns ?? []).filter(
            (entry) => entry.capitalReturnId !== target,
          ),
        });
        const value = await appendCapitalReturnVersion(manager, owner, {
          ...projectCapitalReturnVersion(row),
          kind: 'void',
          version: row.version + 1,
          journalRevision: held.journal.currentRevision + 1,
          requestId: input.requestId,
          canonicalPayload,
        });
        await advanceConnectedJournals(manager, owner, ledger);
        return { created: true, value };
      });
    } catch (error) {
      return rethrowAccountingHistory(error);
    }
  }
}
