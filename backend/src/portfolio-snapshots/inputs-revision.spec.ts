import { INPUT_TABLES, INPUTS_REVISION } from './portfolio-snapshots.service';

// No code updates or deletes a row of these tables: a void or an edit is a new row.
const APPEND_ONLY = [
  'account_trade_versions',
  'account_opening_snapshots',
  'account_opening_positions',
  'account_carry_in_lots',
  'account_reward_versions',
  'account_swap_versions',
  'account_capital_return_versions',
  'instrument_splits',
  'owned_transfer_versions',
  'manual_usd_price_versions',
  'wallet_stake_moves',
  'wallet_ether_stake_moves',
  'wallet_ether_stake_rewards',
  'wallet_tron_stake_moves',
];
const parts = INPUTS_REVISION.split(' UNION ALL ');
const part = (table: string) => {
  const found = parts.filter((sql) => sql.includes(`FROM ${table} t WHERE t."ownerId"=$1`));
  expect(found).toHaveLength(1);
  return found[0];
};

describe('SNAP-REVISION: the inputs revision of an owner', () => {
  it('reads every input table and which account each address belongs to, for that owner only', () => {
    expect(parts).toHaveLength(INPUT_TABLES.length + 1);
    for (const table of [...INPUT_TABLES, 'wallet_addresses']) part(table);
    expect(APPEND_ONLY.every((table) => (INPUT_TABLES as readonly string[]).includes(table))).toBe(
      true,
    );
  });

  it('counts the rows of an append-only table instead of hashing every row', () => {
    for (const table of APPEND_ONLY) {
      expect(part(table)).toContain('count(*)');
      expect(part(table)).not.toContain('md5');
    }
  });

  it('hashes every row of a table whose rows are updated or deleted in place', () => {
    for (const table of INPUT_TABLES.filter((name) => !APPEND_ONLY.includes(name)))
      expect(part(table)).toContain("md5(string_agg(t::text, ',' ORDER BY t::text))");
    expect(part('wallet_addresses')).toContain(
      `md5(string_agg(t.id::text || ':' || coalesce(t."accountId"::text, '')`,
    );
  });
});
