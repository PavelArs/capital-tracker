import type { DataSource, EntityManager } from 'typeorm';
import { rethrowAccountingHistory } from './connected-accounting.store';

/** One read in a read-only snapshot; a history the replay refuses comes back as a conflict. */
export function readAccountingSnapshot<T>(
  source: DataSource,
  work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  return source.transaction('REPEATABLE READ', async (manager) => {
    await manager.query('SET TRANSACTION READ ONLY');
    try {
      return await work(manager);
    } catch (error) {
      return rethrowAccountingHistory(error);
    }
  });
}
