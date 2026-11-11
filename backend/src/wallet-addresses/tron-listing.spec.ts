import {
  DEEP_TRON_PAGES,
  MAX_TRON_PAGES,
  readTronLists,
  type TronPageReader,
} from './tron-listing';
import type { PageResult } from './trongrid-client';

// TRON-LISTING (Codex Security #5): one block time with more records in a list than a pass reads
// kept the cursor in place and the wallet failed with invalid_response on every pass.

interface Item {
  id: string;
  timestamp: number;
}

/** A synthetic list as TronGrid answers it: [from, to] ms, oldest first, `size` items a page. */
function listOf(items: Item[], size: number): { read: TronPageReader<Item>; calls: number[] } {
  const calls: number[] = [];
  const read: TronPageReader<Item> = async (from, to, fingerprint) => {
    calls.push(from);
    const inside = items.filter((item) => item.timestamp >= from && item.timestamp <= to);
    const start = fingerprint ? Number(fingerprint.replace('offset-', '')) : 0;
    const page = inside.slice(start, start + size);
    const next = start + size < inside.length ? `offset-${start + size}` : null;
    return { ok: true, items: page, next } satisfies PageResult<Item>;
  };
  return { read, calls };
}

const at = (timestamp: number, count: number, prefix = 'a'): Item[] =>
  Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}`, timestamp }));

describe('TRON-LISTING: a block time with more records than one pass reads', () => {
  it('stops before the block time of the last item when a later block time follows', async () => {
    const list = listOf([...at(100, 2, 'x'), ...at(200, 40, 'y')], 2);
    const read = await readTronLists([list.read], 0, 1_000);
    expect(read).toMatchObject({ ok: true, end: 199 });
  });

  it('reads a block time of more records than a pass lists in full once the cursor stands before it', async () => {
    // The pass's pages hold 10 of 40 records; the cursor already stands just before them.
    const list = listOf(at(200, 40), 2);
    const read = await readTronLists([list.read], 199, 1_000);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.end).toBe(200);
    expect(read.lists[0].items).toHaveLength(40);
    // MAX_TRON_PAGES pages of the pass, then the 20 pages of the block time alone.
    expect(list.calls).toHaveLength(MAX_TRON_PAGES + 20);
  });

  it('reads a block time that only a later list crowds, and stops at the target block time', async () => {
    const transactions = listOf(at(200, 1, 'tx'), 2);
    const tokens = listOf(at(200, 30, 'token'), 2);
    const read = await readTronLists([transactions.read, tokens.read], 199, 200);
    expect(read).toMatchObject({ ok: true, end: 200 });
    if (!read.ok) return;
    expect(read.lists.map((list) => list.items.length)).toEqual([1, 30]);
  });

  it('accepts a block time of exactly the deep limit', async () => {
    const list = listOf(at(200, DEEP_TRON_PAGES * 2), 2);
    const read = await readTronLists([list.read], 199, 1_000);
    expect(read).toMatchObject({ ok: true, end: 200 });
  });

  it('reads that block time in every list, and only that block time', async () => {
    const transactions = listOf([...at(200, 30, 'tx'), ...at(260, 4, 'later')], 2);
    const tokens = listOf(at(200, 3, 'token'), 2);
    const read = await readTronLists([transactions.read, tokens.read], 199, 1_000);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.end).toBe(200);
    expect(read.lists[0].items.map((item) => item.timestamp)).toEqual(Array(30).fill(200));
    expect(read.lists[1].items).toHaveLength(3);
  });

  it('fails as an invalid answer when even the deep reading does not reach the end', async () => {
    const list = listOf(at(200, DEEP_TRON_PAGES * 2 + 1), 2);
    const read = await readTronLists([list.read], 199, 1_000);
    expect(read).toEqual({ ok: false, reason: 'invalid_response' });
  });

  it('passes a provider failure of the deep reading on', async () => {
    const list = listOf(at(200, 40), 2);
    const failing: TronPageReader<Item> = async (from, to, fingerprint) =>
      from === to ? { ok: false, reason: 'rate_limited' } : list.read(from, to, fingerprint);
    const read = await readTronLists([failing], 199, 1_000);
    expect(read).toEqual({ ok: false, reason: 'rate_limited' });
  });

  it('leaves a pass that reaches the target alone: no second reading', async () => {
    const list = listOf(at(200, 4), 2);
    const read = await readTronLists([list.read], 199, 1_000);
    expect(read).toMatchObject({ ok: true, end: 1_000 });
    expect(list.calls).toHaveLength(2);
  });

  it('refuses a list that is not oldest first', async () => {
    const list = listOf([{ id: 'late', timestamp: 300 }, ...at(200, 1)], 2);
    const read = await readTronLists([list.read], 100, 1_000);
    expect(read).toEqual({ ok: false, reason: 'invalid_response' });
  });
});
