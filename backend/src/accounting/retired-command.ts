import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/** A deleted command remains spent, even after its resource and payload are gone. */
export async function refuseRetiredCommand(
  manager: EntityManager,
  owner: string,
  scope: 'deposit' | 'deposit-movement' | 'deposit-check' | 'goal',
  requestId: string,
): Promise<void> {
  const rows: unknown[] = await manager.query(
    'SELECT 1 FROM retired_commands WHERE "ownerId"=$1 AND scope=$2 AND "requestId"=$3',
    [owner, scope, requestId],
  );
  if (rows.length > 0)
    throw new ConflictException('This command refers to a deleted record. Start a new action.');
}
