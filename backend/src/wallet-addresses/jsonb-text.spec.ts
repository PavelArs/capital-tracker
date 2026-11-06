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

  it('keeps both keys when two become alike, without renaming a key that had no rival', () => {
    const parsed = JSON.parse(jsonbText({ 'a\u0000': 1, 'a\\u0000': 2, 'a\\u0000#2': 3 }));
    expect(parsed).toEqual({ 'a\\u0000': 1, 'a\\u0000#3': 2, 'a\\u0000#2': 3 });
  });

  it('keeps a __proto__ key and its value, as JSON.stringify does', () => {
    const raw = JSON.parse('{"__proto__":{"a":1},"x":2,"deep":{"__proto__":"s"}}');
    expect(jsonbText(raw)).toBe(JSON.stringify(raw));
  });

  it('leaves boxed primitives and class instances to JSON.stringify', () => {
    class Token {
      readonly symbol = 'T';
    }
    const raw = { a: Object('hi'), b: Object(5), c: new Token(), d: new Map([[1, 2]]) };
    expect(jsonbText(raw)).toBe(JSON.stringify(raw));
  });

  it('leaves a text without such characters untouched', () => {
    expect(jsonbSafeText('plain 💠')).toBe('plain 💠');
    expect(jsonbSafeText('a\u0000')).toBe('a\\u0000');
  });
});

describe('WAL-JSONB every provider object reaches jsonb through jsonbText', () => {
  // Every JSON.stringify left in the wallet sources, by file. None of them holds provider text:
  // a content hash, the Tron balance summary (numbers as text), a sealed credential. A new one
  // fails here until it is read and either routed through jsonbText or listed with its reason.
  const allowed: Record<string, number> = {
    'bybit-records.ts': 1,
    'jsonb-text.ts': 1,
    'tron-sync.adapter.ts': 1,
    'wallet-address.service.ts': 1,
  };

  it('leaves no unlisted JSON.stringify in the wallet sources', () => {
    const found: Record<string, number> = {};
    for (const name of readdirSync(__dirname)) {
      if (!name.endsWith('.ts') || name.endsWith('.spec.ts')) continue;
      const count = readFileSync(join(__dirname, name), 'utf8').split('JSON.stringify(').length - 1;
      if (count > 0) found[name] = count;
    }
    expect(found).toEqual(allowed);
  });
});
