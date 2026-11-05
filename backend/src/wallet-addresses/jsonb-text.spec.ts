import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { jsonbSafeText, jsonbText } from './jsonb-text';

// WAL-JSONB: one provider string that PostgreSQL jsonb refuses must not stop a wallet's sync.
// Synthetic provider objects only.
describe('WAL-JSONB jsonbText', () => {
  it('is JSON.stringify for an object jsonb accepts', () => {
    const raw = {
      txid: 'a'.repeat(64),
      list: [1, 'two', null, { deep: true }],
      text: 'Tëst 💠 token',
      nothing: null,
    };
    expect(jsonbText(raw)).toBe(JSON.stringify(raw));
    expect(jsonbText({ ...raw, when: new Date('2026-01-02T03:04:05.000Z') })).toBe(
      JSON.stringify({ ...raw, when: new Date('2026-01-02T03:04:05.000Z') }),
    );
  });

  it('writes U+0000 and unpaired surrogates as visible escapes, in values, keys and arrays', () => {
    const text = jsonbText({
      'na\u0000me': 'a\u0000b',
      list: ['\ud800', 'x\udc00y', 'ok 💠'],
    });
    expect(JSON.stringify(JSON.parse(text))).not.toMatch(/(?<!\\)\\u(0000|d[89a-f]..)/i);
    expect(JSON.parse(text)).toEqual({
      'na\\u0000me': 'a\\u0000b',
      list: ['\\ud800', 'x\\udc00y', 'ok 💠'],
    });
  });

  it('keeps both keys when two become alike', () => {
    const parsed = JSON.parse(jsonbText({ 'a\u0000': 1, 'a\\u0000': 2 }));
    expect(Object.values(parsed).sort()).toEqual([1, 2]);
  });

  it('leaves a text without such characters untouched', () => {
    expect(jsonbSafeText('plain 💠')).toBe('plain 💠');
    expect(jsonbSafeText('a\u0000')).toBe('a\\u0000');
  });
});

describe('WAL-JSONB every provider object reaches jsonb through jsonbText', () => {
  it('leaves no JSON.stringify of a raw leg or of sync progress in the wallet sources', () => {
    const directory = __dirname;
    const offenders = readdirSync(directory)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
      .flatMap((name) =>
        readFileSync(join(directory, name), 'utf8')
          .split('\n')
          .map((line, index) => ({ at: `${name}:${index + 1}`, line }))
          .filter(({ line }) =>
            /JSON\.stringify\([^)]*(\.raw|solanaSync|evmSync|next\b|progress)/.test(line),
          )
          .map(({ at }) => at),
      );
    expect(offenders).toEqual([]);
  });
});
