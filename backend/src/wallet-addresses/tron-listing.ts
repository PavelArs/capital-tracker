import type { StepFailure } from './chain-sync';
import type { PageResult } from './trongrid-client';

// TRON-LISTING: how one pass of the Tron sync reads the lists TronGrid keeps for a wallet.

/** Pages of one list in one pass. */
export const MAX_TRON_PAGES = 5;
/**
 * Pages of one list when a single block time fills more than a pass: every record of that block
 * time is wanted before the cursor may move past it.
 */
export const DEEP_TRON_PAGES = 100;

/** One page of a list of the records with block times in [from, to] ms, oldest first. */
export type TronPageReader<T> = (
  from: number,
  to: number,
  fingerprint: string | null,
) => Promise<PageResult<T>>;

export type Listed<T> = { ok: true; items: T[]; end: number } | { ok: false; reason: StepFailure };

/** The lists of one pass, read up to `end`: nothing after that block time is complete. */
export type TronLists<T> =
  | { ok: true; lists: { items: T[] }[]; end: number }
  | { ok: false; reason: StepFailure };

/**
 * Every page of one list, up to `maxPages`. A list that has more pages ends before the block time
 * of its last item, which may continue on the next page.
 */
async function listPages<T extends { timestamp: number }>(
  read: (fingerprint: string | null) => Promise<PageResult<T>>,
  maxPages: number,
): Promise<Listed<T>> {
  const items: T[] = [];
  let fingerprint: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const listed = await read(fingerprint);
    if (!listed.ok) return listed;
    for (const item of listed.items) {
      // Oldest first: anything else is an answer this reading cannot trust.
      if (items.length > 0 && item.timestamp < items[items.length - 1].timestamp)
        return { ok: false, reason: 'invalid_response' };
      items.push(item);
    }
    if (!listed.next) return { ok: true, items, end: Number.POSITIVE_INFINITY };
    fingerprint = listed.next;
  }
  const last = items[items.length - 1];
  return { ok: true, items, end: last ? last.timestamp - 1 : Number.NEGATIVE_INFINITY };
}

async function listAll<T extends { timestamp: number }>(
  readers: readonly TronPageReader<T>[],
  from: number,
  to: number,
  maxPages: number,
): Promise<TronLists<T>> {
  const lists: { items: T[] }[] = [];
  let end = to;
  for (const read of readers) {
    const listed = await listPages((fingerprint) => read(from, to, fingerprint), maxPages);
    if (!listed.ok) return listed;
    lists.push({ items: listed.items });
    end = Math.min(end, listed.end);
  }
  return { ok: true, lists, end };
}

/**
 * The lists of the block times after `after` (the committed cursor) up to `target`. A pass reads a
 * few pages of each list and ends before the block time of its last item. When one block time
 * alone fills those pages, the cursor stands just before it and could never move: that block time
 * is then read on its own, deeper, and every record of it is returned with `end` at it.
 */
export async function readTronLists<T extends { timestamp: number }>(
  readers: readonly TronPageReader<T>[],
  after: number,
  target: number,
): Promise<TronLists<T>> {
  const first = await listAll(readers, after + 1, target, MAX_TRON_PAGES);
  if (!first.ok || first.end > after) return first;
  const block = after + 1;
  const deep = await listAll(readers, block, block, DEEP_TRON_PAGES);
  if (!deep.ok) return deep;
  // Still not all of it: this block time is more than the sync can take in.
  if (deep.end < block) return { ok: false, reason: 'invalid_response' };
  return { ok: true, lists: deep.lists, end: Math.min(block, target) };
}
