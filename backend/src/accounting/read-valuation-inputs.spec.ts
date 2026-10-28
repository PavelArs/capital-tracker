import type { EntityManager } from 'typeorm';
import { readValuationInputs } from './portfolio-valuation.service';

const owner = '00000000-0000-4000-8000-000000000001';
const ids = ['a', 'b', 'c'].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
const start = new Date('2025-01-01T00:00:00.000Z');

/** Answers only what three started accounts without operations need; everything else is empty. */
function manager() {
  const sql: string[] = [];
  const query = async (text: string, params: unknown[] = []) => {
    sql.push(text);
    if (text.includes('FROM manual_accounts a'))
      return ids.map((accountId) => ({
        accountId,
        name: accountId,
        assetClass: null,
        coverageFrom: start,
      }));
    if (text.startsWith('SELECT * FROM account_trade_journals'))
      return (params[1] as string[]).map((accountId) => ({
        accountId,
        coverageFrom: start,
        originKind: 'declared-empty',
      }));
    return [];
  };
  return {
    sql,
    manager: { query, queryRunner: { isTransactionActive: true } } as unknown as EntityManager,
  };
}

it('PERF-LEDGER-BATCH reads every ledger of the owner with one query per table', async () => {
  const { sql, manager: db } = manager();
  const inputs = await readValuationInputs(db, owner);
  expect([...inputs.ledgers.keys()]).toEqual(ids);
  // Three accounts without transfers between them are three ledgers, read together.
  expect(new Set(inputs.ledgers.values()).size).toBe(3);
  expect(sql.filter((text) => text.startsWith('SELECT * FROM account_trade_journals')).length).toBe(
    1,
  );
  expect(sql.filter((text) => text.includes('FROM instrument_splits')).length).toBe(1);
  expect(sql.filter((text) => text.includes('owned_transfer_versions')).length).toBe(1);
});

it('PERF-LEDGER-BATCH reads an owner whose accounts have not started without a transaction', async () => {
  const query = async (text: string) =>
    text.includes('FROM manual_accounts a')
      ? [{ accountId: ids[0], name: 'Wallet', assetClass: null, coverageFrom: null }]
      : [];
  const db = { query, queryRunner: { isTransactionActive: false } } as unknown as EntityManager;
  await expect(readValuationInputs(db, owner)).resolves.toMatchObject({ ledgers: new Map() });
});
