import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const normalizer =
  process.env.MVP_SNAPSHOT_NORMALIZER_UNDER_TEST ??
  resolve(__dirname, '../../../scripts/normalize-release-snapshot.awk');
const pairs = [
  [
    '    CONSTRAINT account_csv_imports_check CHECK (((("byteLength" >= 1) AND ("byteLength" <= 262144)) AND (octet_length("originalBytes") = "byteLength"))),',
    '    CONSTRAINT account_csv_imports_check CHECK ((("byteLength" >= 1) AND ("byteLength" <= 262144) AND (octet_length("originalBytes") = "byteLength"))),',
  ],
  [
    "    CONSTRAINT account_csv_imports_filename_check CHECK ((((length(filename) >= 1) AND (length(filename) <= 120)) AND (POSITION(('/'::text) IN (filename)) = 0) AND (POSITION((chr(92)) IN (filename)) = 0) AND (filename !~ ((((((('['::text || chr(1)) || '-'::text) || chr(31)) || chr(127)) || '-'::text) || chr(159)) || ']'::text)))),",
    "    CONSTRAINT account_csv_imports_filename_check CHECK (((length(filename) >= 1) AND (length(filename) <= 120) AND (POSITION(('/'::text) IN (filename)) = 0) AND (POSITION((chr(92)) IN (filename)) = 0) AND (filename !~ ((((((('['::text || chr(1)) || '-'::text) || chr(31)) || chr(127)) || '-'::text) || chr(159)) || ']'::text)))),",
  ],
  [
    "    CONSTRAINT auth_sessions_state_check CHECK (((state)::text = ANY ((ARRAY['anonymous'::character varying, 'pending_mfa'::character varying, 'authenticated'::character varying])::text[]))),",
    "    CONSTRAINT auth_sessions_state_check CHECK (((state)::text = ANY (ARRAY[('anonymous'::character varying)::text, ('pending_mfa'::character varying)::text, ('authenticated'::character varying)::text]))),",
  ],
  [
    "    CONSTRAINT \"owner_settings_mainCurrency_check\" CHECK (((\"mainCurrency\")::text = ANY ((ARRAY['USD'::character varying, 'EUR'::character varying, 'RUB'::character varying])::text[]))),",
    "    CONSTRAINT \"owner_settings_mainCurrency_check\" CHECK (((\"mainCurrency\")::text = ANY (ARRAY[('USD'::character varying)::text, ('EUR'::character varying)::text, ('RUB'::character varying)::text]))),",
  ],
  [
    "    CONSTRAINT account_trade_version_payments_currency_check CHECK (((currency)::text = ANY ((ARRAY['RUB'::character varying, 'EUR'::character varying])::text[]))),",
    "    CONSTRAINT account_trade_version_payments_currency_check CHECK (((currency)::text = ANY (ARRAY[('RUB'::character varying)::text, ('EUR'::character varying)::text]))),",
  ],
  [
    '    CONSTRAINT "account_trade_version_payments_rateSource_check" CHECK ((("rateSource")::text = ANY ((ARRAY[\'bank-of-russia\'::character varying, \'owner\'::character varying])::text[])))',
    '    CONSTRAINT "account_trade_version_payments_rateSource_check" CHECK ((("rateSource")::text = ANY (ARRAY[(\'bank-of-russia\'::character varying)::text, (\'owner\'::character varying)::text])))',
  ],
];
function normalize(input: string) {
  const result = spawnSync('awk', ['-f', normalizer], { input, encoding: 'utf8', timeout: 5000 });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status).toBe(0);
  return result.stdout;
}
describe('exact PostgreSQL snapshot normalization', () => {
  it.each(pairs)('normalizes only the reviewed equivalent line %s', (source, restored) => {
    expect(normalize(`${source}\n`)).toBe(`${restored}\n`);
    expect(normalize(`${source}\n`)).toBe(normalize(`${restored}\n`));
  });
  it.each([
    [0, '262144', '262143'],
    [1, '<= 120', '<= 119'],
    [2, 'authenticated', 'different_state'],
    [3, "'RUB'", "'GBP'"],
    [4, "'EUR'", "'USD'"],
    [5, "'owner'", "'manual'"],
  ] as const)('retains different bound/state operand in pair %i', (index, before, after) => {
    const changed = pairs[index][0].replace(before, after);
    expect(normalize(`${changed}\n`)).toBe(`${changed}\n`);
    expect(normalize(`${changed}\n`)).not.toBe(normalize(`${pairs[index][1]}\n`));
  });
  it('preserves every COPY data byte including comments, empty/restrict-looking rows and mapped-looking lines', () => {
    const data = [
      '-- literal row',
      '',
      '\\restrict data-not-directive',
      pairs[0][0],
      '1\t123.4500\t\\x00ff\tfilename.csv',
    ];
    const dump = (rows: readonly string[]) =>
      ['COPY public.synthetic FROM stdin;', ...rows, '\\.', 'SELECT 1;', ''].join('\n');
    // Rows come out unchanged, in byte order (all rows here are ASCII).
    expect(normalize(dump(data))).toBe(dump([...data].sort()));
    for (const altered of ['123.4501', '\\x00fe', 'different.csv']) {
      const changed = dump(data).replace(
        altered.startsWith('123')
          ? '123.4500'
          : altered.startsWith('\\')
            ? '\\x00ff'
            : 'filename.csv',
        altered,
      );
      expect(normalize(changed)).not.toBe(normalize(dump(data)));
    }
  });
  it('ignores the physical order of COPY rows but not a missing, duplicated or moved row', () => {
    const rows = ['b\t2', 'a\t1', 'c\t3', 'a\t10'];
    const dump = (first: readonly string[], second: readonly string[] = ['z\t9']) =>
      [
        'SELECT 1;',
        'COPY public.first (key, value) FROM stdin;',
        ...first,
        '\\.',
        '',
        'COPY public.second (key, value) FROM stdin;',
        ...second,
        '\\.',
        '',
        'ALTER TABLE ONLY public.first ADD CONSTRAINT first_pkey PRIMARY KEY (key);',
        '',
      ].join('\n');
    const expected = normalize(dump(rows));
    expect(expected).toBe(dump(['a\t1', 'a\t10', 'b\t2', 'c\t3']));
    expect(normalize(dump([...rows].reverse()))).toBe(expected);
    expect(normalize(dump(['c\t3', 'a\t10', 'b\t2', 'a\t1']))).toBe(expected);
    expect(normalize(dump(rows.slice(1)))).not.toBe(expected);
    expect(normalize(dump([...rows, 'b\t2']))).not.toBe(expected);
    expect(normalize(dump(rows.slice(1), ['b\t2', 'z\t9']))).not.toBe(expected);
    expect(normalize(dump([], []))).toBe(dump([], []));
  });
  it('preserves dollar-quoted SQL bodies and unrelated DDL exactly', () => {
    const dump = [
      'CREATE FUNCTION synthetic() RETURNS text AS $body$',
      '-- literal body comment',
      pairs[0][0],
      '\\restrict body-data',
      '$body$ LANGUAGE sql;',
      'ALTER TABLE public.synthetic ADD CHECK ((amount >= 0));',
      '',
    ].join('\n');
    expect(normalize(dump)).toBe(dump);
    const changed = dump.replace('amount >= 0', 'amount >= 1');
    expect(normalize(changed)).toBe(changed);
    expect(normalize(changed)).not.toBe(normalize(dump));
  });
});
