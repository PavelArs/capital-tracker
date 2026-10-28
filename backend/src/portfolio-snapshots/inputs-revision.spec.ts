import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { APPEND_ONLY_INPUTS, INPUT_TABLES, INPUTS_REVISION } from './portfolio-snapshots.service';

const APPEND_ONLY = [...APPEND_ONLY_INPUTS];
const parts = INPUTS_REVISION.split(' UNION ALL ');
const part = (table: string) => {
  const found = parts.filter((sql) => sql.includes(`FROM ${table} t WHERE t."ownerId"=$1`));
  expect(found).toHaveLength(1);
  return found[0];
};

// Every statement that would rewrite or remove a row of the table in place.
function inPlaceWrites(source: string, table: string): string[] {
  const name = `"?${table}"?\\b`;
  return [
    new RegExp(`\\bUPDATE\\s+${name}`, 'gi'),
    new RegExp(`\\bDELETE\\s+FROM\\s+${name}`, 'gi'),
    new RegExp(`\\bTRUNCATE\\s+(TABLE\\s+)?${name}`, 'gi'),
    new RegExp(`\\bINTO\\s+${name}[^\`]*?\\bDO\\s+UPDATE`, 'gi'),
    // A table name built at run time could be any of them.
    /\b(UPDATE|DELETE\s+FROM|TRUNCATE)\s+\$\{/gi,
  ].flatMap((pattern) => source.match(pattern) ?? []);
}

const root = join(__dirname, '..');
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'migrations' ? [] : sources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

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
    for (const table of INPUT_TABLES.filter((name) => !APPEND_ONLY_INPUTS.has(name)))
      expect(part(table)).toContain("md5(string_agg(t::text, ',' ORDER BY t::text))");
    expect(part('wallet_addresses')).toContain(
      `md5(string_agg(t.id::text || ':' || coalesce(t."accountId"::text, '')`,
    );
  });

  it('finds an in-place write to an append-only table', () => {
    const table = 'account_trade_versions';
    expect(inPlaceWrites(`UPDATE ${table} SET x=1`, table)).toHaveLength(1);
    expect(inPlaceWrites(`DELETE FROM "${table}" WHERE id=$1`, table)).toHaveLength(1);
    expect(inPlaceWrites(`TRUNCATE ${table}`, table)).toHaveLength(1);
    expect(
      inPlaceWrites(
        `INSERT INTO ${table}(id) VALUES ($1) ON CONFLICT (id) DO UPDATE SET id=1`,
        table,
      ),
    ).toHaveLength(1);
    expect(inPlaceWrites('DELETE FROM ${table} WHERE id=$1', table)).toHaveLength(1);
    expect(
      inPlaceWrites(`INSERT INTO ${table}(id) VALUES ($1) ON CONFLICT DO NOTHING`, table),
    ).toEqual([]);
    expect(inPlaceWrites(`UPDATE ${table}_other SET x=1`, table)).toEqual([]);
  });

  it('no code outside migrations updates, deletes or upserts a row of an append-only table', () => {
    const files = sources(root);
    expect(files.length).toBeGreaterThan(100);
    const found = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return APPEND_ONLY.flatMap((table) =>
        inPlaceWrites(source, table).map((match) => `${relative(root, file)}: ${match}`),
      );
    });
    expect(found).toEqual([]);
  });
});
